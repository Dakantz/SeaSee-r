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

        self.setup_rerun_alignment(gt_poses, synced_gt)
        
        if self.viewer3D:
            self.viewer3D.wait_for_ready()

        self.traj3d_est_online = []

    def setup_rerun_alignment(self, gt_poses, synced_gt):
        self.R_align = np.eye(3)
        if self.is_draw_with_rerun and synced_gt is not None and synced_gt.poses is not None and len(synced_gt.poses) > 5:
            T0_inv = np.linalg.inv(synced_gt.poses[0])
            p5 = (T0_inv @ synced_gt.poses[5])[:3, 3]
            norm_p5 = np.linalg.norm(p5)
            if norm_p5 > 1e-6:
                a = p5 / norm_p5
                b = np.array([1.0, 0.0, 0.0])
                v = np.cross(a, b)
                c = np.dot(a, b)
                if c > -0.9999 and c < 0.9999:
                    s = np.linalg.norm(v)
                    kmat = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
                    self.R_align = np.eye(3) + kmat + kmat.dot(kmat) * ((1 - c) / (s ** 2))
                elif c <= -0.9999:
                    self.R_align = -np.eye(3)

        self.R_align_4x4 = np.eye(4)
        self.R_align_4x4[:3, :3] = self.R_align

        self.rerun_gt_traj3d = None
        self.rerun_gt_poses = None
        if self.is_draw_with_rerun and gt_poses is not None and len(gt_poses) > 0:
            T0_inv = np.linalg.inv(gt_poses[0])
            self.rerun_gt_poses = np.array([self.R_align_4x4 @ T0_inv @ p for p in gt_poses])
            self.rerun_gt_traj3d = self.rerun_gt_poses[:, :3, 3]

        self.rerun_synced_gt_traj3d = None
        self.rerun_synced_gt_poses = None
        if self.is_draw_with_rerun and synced_gt is not None and synced_gt.poses is not None and len(synced_gt.poses) > 0:
            T0_inv = np.linalg.inv(synced_gt.poses[0])
            self.rerun_synced_gt_poses = np.array([self.R_align_4x4 @ T0_inv @ p for p in synced_gt.poses])
            self.rerun_synced_gt_traj3d = self.rerun_synced_gt_poses[:, :3, 3]

        if self.rerun_gt_traj3d is not None:
            Rerun.log_3d_trajectory(0, self.rerun_gt_traj3d, "ground_truth", color=[255, 0, 0])

        if self.rerun_synced_gt_traj3d is not None:
            Rerun.log_3d_trajectory(0, self.rerun_synced_gt_traj3d, "synced_ground_truth", color=[255, 255, 0])

    def draw_slam_map(self, slam):
        if self.viewer3D:
            self.viewer3D.draw_slam_map(slam)
            
    def draw_dense_map(self, slam):
        if self.viewer3D:
            self.viewer3D.draw_dense_map(slam)

    def draw_current_frame(self, slam, img_id, img_draw, depth, camera, fps):
        if self.headless:
            return
            
        fps_text = f" fps: {fps:.1f}" if USE_CPP else ""
        self.img_writer.write(img_draw, f"id: {img_id} {fps_text}", (20, 20))
        
        if self.is_draw_with_rerun:
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

        if slam.tracking.cur_R is not None and slam.tracking.cur_t is not None:
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
                Rerun.log_3d_trajectory(img_id, self.rerun_gt_traj3d[:img_id+1], "ground_truth", color=[255, 0, 0])
                if self.rerun_gt_poses is not None and len(self.rerun_gt_poses) > img_id:
                    Rerun.log_3d_camera_pose(img_id, camera, self.rerun_gt_poses[img_id], color=[255, 0, 0], size=1)

            if self.rerun_synced_gt_traj3d is not None and len(self.rerun_synced_gt_traj3d) > img_id:
                gt_pos = self.rerun_synced_gt_traj3d[img_id]
                x, y, z = cur_T_w_c[:3, 3]
                gt_x, gt_y, gt_z = gt_pos
                Rerun.log_2d_seq_scalar("trajectory_error/synced_ground_truth_err_x", img_id, (gt_x - x))
                Rerun.log_2d_seq_scalar("trajectory_error/synced_ground_truth_err_y", img_id, (gt_y - y))
                Rerun.log_2d_seq_scalar("trajectory_error/synced_ground_truth_err_z", img_id, (gt_z - z))
                Rerun.log_3d_trajectory(img_id, self.rerun_synced_gt_traj3d[:img_id+1], "synced_ground_truth", color=[255, 255, 0])
                if self.rerun_synced_gt_poses is not None and len(self.rerun_synced_gt_poses) > img_id:
                    Rerun.log_3d_camera_pose(img_id, camera, self.rerun_synced_gt_poses[img_id], color=[255, 255, 0], size=1)

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
