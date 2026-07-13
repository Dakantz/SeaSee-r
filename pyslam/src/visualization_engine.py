import numpy as np
from pyslam.slam import USE_CPP
from pyslam.utilities.colors import GlColors
from pyslam.utilities.img_management import ImgWriter
from pyslam.viz.cvimage_thread import CvImageViewer
from pyslam.viz.slam_plot_drawer import SlamPlotDrawerThread
from pyslam.viz.viewer3D import Viewer3D
from pyslam.viz.rerun_interface import Rerun

def draw_associated_cameras(viewer3D, assoc_est_poses, assoc_gt_poses, T_gt_est):
    T_est_gt = np.linalg.inv(T_gt_est)
    scale = np.mean([np.linalg.norm(T_est_gt[i, :3]) for i in range(3)])
    R_est_gt = T_est_gt[:3, :3] / scale
    assoc_gt_poses_aligned = [np.eye(4) for i in range(len(assoc_gt_poses))]
    for i, assoc_gt_pose in enumerate(assoc_gt_poses):
        assoc_gt_poses_aligned[i][:3, 3] = T_est_gt[:3, :3] @ assoc_gt_pose[:3, 3] + T_est_gt[:3, 3]
        assoc_gt_poses_aligned[i][:3, :3] = R_est_gt @ assoc_gt_pose[:3, :3]
    viewer3D.draw_cameras([assoc_est_poses, assoc_gt_poses_aligned], [GlColors.kCyan, GlColors.kMagenta])


class VisualizationEngine:
    def __init__(self, headless, dataset, has_groundtruth, eval_ate_correct_scale, gt_traj3d, gt_timestamps, gt_poses, synced_gt):
        self.headless = headless
        
        self.kUseRerun = True
        if self.kUseRerun and not Rerun.is_ok():
            self.kUseRerun = False
            
        self.is_draw_with_rerun = self.kUseRerun and not self.headless
        if self.is_draw_with_rerun:
            Rerun.init_vo()
            
        if self.headless:
            self.viewer3D = None
            self.plot_drawer = None
            self.cv_image_viewer = None
            self.img_writer = None
        else:
            self.viewer3D = Viewer3D(scale=dataset.scale_viewer_3d)
            self.plot_drawer = None
            self.cv_image_viewer = None
            self.img_writer = ImgWriter(font_scale=0.5)

        if self.viewer3D:
            print(f"Viewer3D scale: {self.viewer3D.scale}")

        if has_groundtruth and self.viewer3D:
            self.viewer3D.set_gt_trajectory(gt_traj3d, gt_timestamps, align_with_scale=eval_ate_correct_scale)

        if has_groundtruth and self.is_draw_with_rerun:
            import multiprocessing as mp
            from pyslam.utilities.geom_trajectory import TrajectoryAlignerProcessBatch
            from pyslam.utilities.logging import Printer
            
            self.aligner_input_queue = mp.Queue()
            self.aligner_output_queue = mp.Queue()
            self.is_aligner_running = mp.Value("i", 1)
            
            self.gt_trajectory = gt_traj3d
            self.gt_timestamps = gt_timestamps
            self.align_gt_with_scale = eval_ate_correct_scale
            
            trajectory_aligner_class = TrajectoryAlignerProcessBatch
            self.trajectory_aligner = trajectory_aligner_class(
                input_queue=self.aligner_input_queue,
                output_queue=self.aligner_output_queue,
                is_running_flag=self.is_aligner_running,
                gt_trajectory=self.gt_trajectory,
                gt_timestamps=self.gt_timestamps,
                find_scale=self.align_gt_with_scale,
                compute_align_error=True,
            )
            self.trajectory_aligner.start()
            Printer.blue(f"VisualizationEngine: trajectory aligner started")

        if self.viewer3D:
            self.viewer3D.wait_for_ready()

        self.traj3d_est_online = []
        self.rerun_gt_traj3d = None
        self.img_draw_cache = {}

    def draw_slam_map(self, slam):
        if self.viewer3D:
            self.viewer3D.draw_slam_map(slam)
            
        if self.is_draw_with_rerun:
            try:
                map_state = slam.map.get_data_arrays_for_drawing(100000, 10)
            except AttributeError:
                map_state = slam.map.get_state(get_covisibility_graph=True)
                
            if map_state is not None:
                if hasattr(self, 'trajectory_aligner'):
                    estimated_trajectory = np.asarray([p[:3, 3] for p in map_state.poses], dtype=float)
                    self.aligner_input_queue.put((map_state.pose_timestamps, estimated_trajectory))
                    
                    from pyslam.utilities.data_management import get_last_item_from_queue
                    aligner_output = get_last_item_from_queue(self.aligner_output_queue)
                    if aligner_output is not None:
                        T_gt_est, error, alignment_gt_data = aligner_output
                        # self.rerun_gt_traj3d = alignment_gt_data.gt_t_wi
                        Rerun.log_3d_trajectory(0, alignment_gt_data.gt_trajectory_aligned, "ground_truth", color=[255, 0, 0])
                    else:
                        pass # avoid printing every frame

                display_sparse_map = False
                if hasattr(map_state, 'points') and len(map_state.points) > 0 and display_sparse_map:
                    colors = map_state.colors * 255 if hasattr(map_state, 'colors') and map_state.colors is not None else None
                    Rerun.log_3d_pointcloud(
                        0.0,
                        np.array(map_state.points),
                        topic="world/sparse_map",
                        colors=colors,
                        point_radius=0.01,
                    )
                if hasattr(map_state, 'poses') and len(map_state.poses) > 0:
                    traj_pts = np.array([p[:3, 3] for p in map_state.poses])
                    Rerun.log_3d_trajectory(0, traj_pts, "map_trajectory", color=[0, 255, 0])
            
    def draw_dense_map(self, slam):
        if self.viewer3D:
            self.viewer3D.draw_dense_map(slam)

    def draw_current_frame(self, slam, img_id, img_draw, depth, camera, fps):
        if self.headless:
            return
            
        fps_text = f" fps: {fps:.1f}" if USE_CPP else ""
        self.img_writer.write(img_draw, f"id: {img_id} {fps_text}", (20, 20))
        
        self.img_draw_cache[img_id] = img_draw
        
        if self.is_draw_with_rerun:
            Rerun.log_img_seq("trajectory_img/2d", img_id, img_draw)
            if slam.tracking.f_cur is not None:
                cur_pose = slam.tracking.f_cur.Twc()
                if cur_pose is not None:
                    cur_pose_copy = cur_pose.copy()
                    # draw current pose in blue
                    Rerun.log_3d_camera_pose("current", camera, cur_pose_copy, color=[0, 0, 255])
                    Rerun.log_3d_camera_img_seq(img_id, img_draw, None, camera, cur_pose_copy)
                    
            num_matches = getattr(slam.tracking, "num_matched_kps", 0)
            if num_matches is None: num_matches = 0
            num_inliers = getattr(slam.tracking, "num_inliers", 0)
            if num_inliers is None: num_inliers = 0
            
            Rerun.log_2d_seq_scalar("trajectory_stats/num_matches", img_id, num_matches)
            Rerun.log_2d_seq_scalar("trajectory_stats/num_inliers", img_id, num_inliers)

            try:
                map_state = slam.map.get_data_arrays_for_drawing(100000, 10)
            except AttributeError:
                map_state = slam.map.get_state(get_covisibility_graph=True)
                
            if map_state is not None:
                if len(map_state.covisibility_graph) > 0:
                    lines = np.array(map_state.covisibility_graph).reshape(-1, 2, 3)
                    Rerun.log_3d_lines("world/map_covisibility_graph", lines, color=[0, 255, 0], size=0.01)
                if len(map_state.spanning_tree) > 0:
                    lines = np.array(map_state.spanning_tree).reshape(-1, 2, 3)
                    Rerun.log_3d_lines("world/map_spanning_tree", lines, color=[0, 0, 255], size=0.1)
                    
                    from pyslam.io.trajectory_writer import TrajectoryWriter
                    tum_writer = TrajectoryWriter("tum", "spanning_tree.tum")
                    tum_writer.write_full_trajectory(map_state.poses, map_state.pose_timestamps)

    def log_trajectory(self, slam, img_id, camera):
        if self.headless or not self.is_draw_with_rerun:
            return

        show_estimated = False
        if slam.tracking.cur_R is not None and slam.tracking.cur_t is not None and show_estimated:
            cur_T_c_w = np.eye(4)
            cur_T_c_w[:3, :3] = slam.tracking.cur_R
            cur_T_c_w[:3, 3] = slam.tracking.cur_t.ravel()
            cur_T_w_c = np.linalg.inv(cur_T_c_w)
            
            self.traj3d_est_online.append(cur_T_w_c[:3, 3])
            Rerun.log_3d_trajectory(img_id, self.traj3d_est_online, "estimated", color=[0, 0, 255])
            
            if self.rerun_gt_traj3d is not None and len(self.rerun_gt_traj3d) > img_id:
                gt_pos = self.rerun_gt_traj3d[img_id]
                x, y, z = cur_T_w_c[:3, 3]
                gt_x, gt_y, gt_z = gt_pos
                Rerun.log_2d_seq_scalar("trajectory_error/err_x", img_id, (gt_x - x))
                Rerun.log_2d_seq_scalar("trajectory_error/err_y", img_id, (gt_y - y))
                Rerun.log_2d_seq_scalar("trajectory_error/err_z", img_id, (gt_z - z))

    def handle_ui_events(self):
        key = None
        key_cv = None
        if not self.headless:
            key = self.plot_drawer.get_key() if self.plot_drawer else None
            key_cv = self.cv_image_viewer.get_key() if self.cv_image_viewer else None
        return key, key_cv
        
    def quit(self):
        if self.cv_image_viewer:
            self.cv_image_viewer.quit()
        if self.plot_drawer:
            self.plot_drawer.quit()
        if self.viewer3D:
            self.viewer3D.quit()
        if hasattr(self, 'trajectory_aligner') and self.trajectory_aligner is not None:
            self.is_aligner_running.value = 0
            self.trajectory_aligner.join()
