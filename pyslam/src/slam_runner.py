import time
import json
import numpy as np
from pyslam.config_parameters import Parameters
from pyslam.depth_estimation.depth_estimator_factory import depth_estimator_factory, DepthEstimatorType
from pyslam.slam.slam import Slam, SlamState
from pyslam.utilities.depth import filter_shadow_points, img_from_depth
from pyslam.utilities.logging import Printer
from pyslam.utilities.timer import TimerFps
from pyslam.utilities.geom_trajectory import find_poses_associations
from pyslam.utilities.evaluation import eval_ate
from visualization_engine import draw_associated_cameras
from state_saver import StateSaver

class SlamRunner:
    def __init__(self, config_obj, data_manager, viz_engine, camera, online_trajectory_writer):
        self.config_obj = config_obj
        self.args = config_obj.args
        self.config = config_obj.config
        self.data_manager = data_manager
        self.viz_engine = viz_engine
        self.camera = camera
        self.online_trajectory_writer = online_trajectory_writer
        self.state_saver = StateSaver(self.config, self.data_manager)
        
        self.depth_estimator = None
        if Parameters.kUseDepthEstimatorInFrontEnd:
            Parameters.kVolumetricIntegrationUseDepthEstimator = False
            depth_estimator_type = DepthEstimatorType.DEPTH_PRO
            max_depth = 20
            self.depth_estimator = depth_estimator_factory(
                depth_estimator_type=depth_estimator_type,
                max_depth=max_depth,
                dataset_env_type=self.data_manager.dataset.environmentType(),
                camera=self.camera,
            )
            Printer.green(f"Depth_estimator_type: {depth_estimator_type.name}, max_depth: {max_depth}")

        self.slam = Slam(
            self.camera,
            self.config.feature_tracker_config,
            self.config.loop_detection_config,
            self.config.semantic_mapping_config,
            self.data_manager.dataset.sensorType(),
            environment_type=self.data_manager.dataset.environmentType(),
            config=self.config,
            headless=True,
        )
        self.slam.set_viewer_scale(self.data_manager.dataset.scale_viewer_3d)
        time.sleep(1)

        if self.config.system_state_load:
            self.slam.load_system_state(self.config.system_state_folder_path)
            viewer_scale = self.slam.viewer_scale() if self.slam.viewer_scale() > 0 else 0.1
            print(f"viewer_scale: {viewer_scale}")
            self.slam.set_tracking_state(SlamState.INIT_RELOCALIZE)

        self.num_tracking_lost = 0
        self.num_frames = 0
        self.img_id = 0
        
        self.do_step = False
        self.do_reset = False
        self.is_paused = False
        self.is_map_save = False
        self.is_bundle_adjust = False
        self.is_viewer_closed = False

    def run(self):
        timer_main = TimerFps("Main", is_verbose=False)
        timer_main.start()

        while not self.is_viewer_closed:
            time_start = time.time()
            
            if self.do_step:
                Printer.orange("do step: ", self.do_step)

            if self.do_reset:
                Printer.yellow("do reset: ", self.do_reset)
                self.slam.reset()

            key = None
            key_cv = None

            if not self.is_paused or self.do_step:
                img, img_right, depth, timestamp, frame_duration = self.data_manager.get_frame(self.img_id)

                if img is not None:
                    print(f"image: {self.img_id}, timestamp: {timestamp}, duration: {frame_duration}")
                    
                    if depth is None and self.depth_estimator:
                        depth_prediction, pts3d_prediction = self.depth_estimator.infer(img, img_right)
                        if Parameters.kDepthEstimatorRemoveShadowPointsInFrontEnd:
                            depth = filter_shadow_points(depth_prediction)
                        else:
                            depth = depth_prediction
                            
                        if not self.args.headless and self.viz_engine.cv_image_viewer:
                            depth_img = img_from_depth(depth_prediction, img_min=0, img_max=50)
                            self.viz_engine.cv_image_viewer.draw(depth_img, "depth prediction")

                    prior_pose = None
                    self.slam.track(img, img_right, depth, self.img_id, timestamp, prior_pose=prior_pose)
                    
                    self.viz_engine.draw_slam_map(self.slam)
                    
                    if not self.args.headless:
                        is_draw_features_with_radius = self.viz_engine.viewer3D.is_draw_features_with_radius() if self.viz_engine.viewer3D else False
                        img_draw = self.slam.map.draw_feature_trails(
                            img,
                            with_level_radius=is_draw_features_with_radius,
                            trail_max_length=Parameters.kMaxFeatureTrailLength,
                        )
                        timer_main.refresh()
                        fps = timer_main.get_fps()
                        self.viz_engine.draw_current_frame(self.slam, self.img_id, img_draw, depth, self.camera, fps)
                        self.viz_engine.log_trajectory(self.slam, self.img_id, self.camera)
                    
                    if self.viz_engine.plot_drawer:
                        self.viz_engine.plot_drawer.draw(self.img_id)

                    if self.online_trajectory_writer is not None and self.slam.tracking.cur_R is not None and self.slam.tracking.cur_t is not None:
                        self.online_trajectory_writer.write_trajectory(self.slam.tracking.cur_R, self.slam.tracking.cur_t, timestamp)

                    self.img_id += 1
                    self.num_frames += 1
                else:
                    time.sleep(0.1)
                    if self.args.headless:
                        break
            else:
                time.sleep(0.1)

            self.viz_engine.draw_dense_map(self.slam)

            if not self.args.headless:
                key, key_cv = self.viz_engine.handle_ui_events()
                
                if self.slam.tracking.state == SlamState.LOST:
                    time.sleep(0.1)

            if self.slam.tracking.state in [SlamState.RELOCALIZE, SlamState.INIT_RELOCALIZE] and not self.slam.tracking.pose_is_ok:
                Printer.red("Relocalization failed, saving state and resetting...")
                self.state_saver.save_map(self.slam)
                self.slam.reset()

            if self.slam.tracking.state == SlamState.LOST:
                self.num_tracking_lost += 1

            if self.is_map_save:
                self.state_saver.save_map(self.slam)

            if self.is_bundle_adjust:
                self.slam.bundle_adjust()
                Printer.blue("\nuncheck pause checkbox on GUI to continue...\n")

            if self.viz_engine.viewer3D:
                if not self.is_paused and self.viz_engine.viewer3D.is_paused():
                    est_poses, timestamps, ids = self.slam.get_final_trajectory()
                    if self.data_manager.has_groundtruth:
                        assoc_timestamps, assoc_est_poses, assoc_gt_poses = find_poses_associations(
                            timestamps, est_poses, self.data_manager.gt_timestamps, self.data_manager.gt_poses
                        )
                        ape_stats, T_gt_est = eval_ate(
                            poses_est=assoc_est_poses,
                            poses_gt=assoc_gt_poses,
                            frame_ids=ids,
                            curr_frame_id=self.img_id,
                            is_final=False,
                            is_monocular=self.data_manager.eval_ate_correct_scale,
                            save_dir=None,
                        )
                        Printer.green(f"EVO stats: {json.dumps(ape_stats, indent=4)}")
                        draw_associated_cameras(self.viz_engine.viewer3D, assoc_est_poses, assoc_gt_poses, T_gt_est)
                    else:
                        Printer.yellow("Ground truth not available: skipping trajectory evaluation on pause")

                self.is_paused = self.viz_engine.viewer3D.is_paused()
                self.is_map_save = self.viz_engine.viewer3D.is_map_save() and self.is_map_save == False
                self.is_bundle_adjust = self.viz_engine.viewer3D.is_bundle_adjust() and self.is_bundle_adjust == False
                self.do_step = self.viz_engine.viewer3D.do_step() and self.do_step == False
                self.do_reset = self.viz_engine.viewer3D.reset() and self.do_reset == False
                self.is_viewer_closed = self.viz_engine.viewer3D.is_closed()

            if not self.args.headless and img is not None:
                processing_duration = time.time() - time_start
                delta_time_sleep = frame_duration - processing_duration - 1e-3
                if delta_time_sleep > 1e-3:
                    time.sleep(delta_time_sleep)

            if key == "q" or (key_cv == ord("q") or key_cv == 27):
                break
