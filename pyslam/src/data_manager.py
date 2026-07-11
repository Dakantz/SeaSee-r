import convert_logdata
from pyslam.config_parameters import Parameters
from pyslam.io.dataset_factory import dataset_factory
from pyslam.io.dataset_types import SensorType
from pyslam.io.ground_truth import groundtruth_factory, is_valid_groundtruth, need_sim3_alignment

class DataManager:
    def __init__(self, config):
        self.config = config
        self.dataset = dataset_factory(self.config)
        
        if Parameters.kUseDepthEstimatorInFrontEnd and self.dataset.sensor_type == SensorType.MONOCULAR:
            self.config.sensor_type = SensorType.RGBD
            self.dataset.sensor_type = SensorType.RGBD
            self.dataset.scale_viewer_3d = 0.5
            
        self.is_monocular = self.dataset.sensor_type == SensorType.MONOCULAR
        self.num_total_frames = self.dataset.num_frames
        
        self.groundtruth = groundtruth_factory(self.config.dataset_settings, cam_settings=self.config.cam_settings)
        self.has_groundtruth = is_valid_groundtruth(self.groundtruth)
        self.eval_ate_correct_scale = self.is_monocular or (self.has_groundtruth and need_sim3_alignment(self.groundtruth))
        
        path = self.config.dataset_settings.get("base_path")
        name = self.config.dataset_settings.get("name")
        if path is not None:
            filename = f"{path}/{name}/pose_left.txt"
        else:
            filename = name
            
        video_filename = "/home/gsoc-thomas/Documents/GsoC/SeaSee-r/pyslam/tests/sample_data/dummy.mp4"
        self.synced_gt = None
        if False:
            self.synced_gt = convert_logdata.process_logdata(video=video_filename, log=filename, input_format="tartanair", start_time="1970-01-01 00:00:00 UTC", stop_time=None)

        self.gt_traj3d = None
        self.gt_poses = None
        self.gt_timestamps = None
        if self.has_groundtruth:
            self.gt_traj3d, self.gt_poses, self.gt_timestamps = self.groundtruth.getFull6dTrajectory()

    def get_frame(self, img_id):
        if not self.dataset.is_ok:
            return None, None, None, None, None
            
        img = self.dataset.getImageColor(img_id)
        depth = self.dataset.getDepth(img_id)
        img_right = self.dataset.getImageColorRight(img_id) if self.dataset.sensor_type == SensorType.STEREO else None
        
        if img is not None:
            timestamp = self.dataset.getTimestamp()
            next_timestamp = self.dataset.getNextTimestamp()
            frame_duration = (next_timestamp - timestamp) if (timestamp is not None and next_timestamp is not None) else -1
            return img, img_right, depth, timestamp, frame_duration
        return None, None, None, None, None
