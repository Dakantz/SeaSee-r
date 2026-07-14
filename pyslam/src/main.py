import os
import sys
import time
import json
import traceback
import platform
import torch.multiprocessing as mp
from datetime import datetime

from configuration import Configuration
from data_manager import DataManager
from visualization_engine import VisualizationEngine
from slam_runner import SlamRunner

from pyslam.slam import PinholeCamera
from pyslam.io.trajectory_writer import TrajectoryWriter
from pyslam.utilities.logging import LoggerQueue, Printer
from pyslam.utilities.system import force_kill_all_and_exit
from pyslam.utilities.serialization import SerializableEnumEncoder
from pyslam.utilities.evaluation import eval_ate
from pyslam.utilities.geom_trajectory import find_poses_associations
from pyslam.semantics.semantic_eval import evaluate_semantic_mapping

if __name__ == "__main__":
    datetime_string = datetime.now().strftime("%Y%m%d_%H%M%S")

    config_obj = Configuration()
    if config_obj.args.no_output_date:
        print("Not appending date to output directory")
        datetime_string = None

    data_manager = DataManager(config_obj.config)
    config_obj.setup_slam_configs(data_manager.dataset.type)

    online_trajectory_writer = None
    final_trajectory_writer = None
    trajectory_saving_base_path = None
    if config_obj.config.trajectory_saving_settings["save_trajectory"]:
        (
            trajectory_online_file_path,
            trajectory_final_file_path,
            trajectory_saving_base_path,
        ) = config_obj.config.get_trajectory_saving_paths(datetime_string)
        online_trajectory_writer = TrajectoryWriter(
            format_type=config_obj.config.trajectory_saving_settings["format_type"],
            filename=trajectory_online_file_path,
        )
        final_trajectory_writer = TrajectoryWriter(
            format_type=config_obj.config.trajectory_saving_settings["format_type"],
            filename=trajectory_final_file_path,
        )
    metrics_save_dir = trajectory_saving_base_path

    camera = PinholeCamera(config_obj.config)
    Printer.green(f"Camera: {json.dumps(camera.to_json(), indent=4, cls=SerializableEnumEncoder)}")

    viz_engine = VisualizationEngine(
        headless=config_obj.args.headless,
        dataset=data_manager.dataset,
        has_groundtruth=data_manager.has_groundtruth,
        eval_ate_correct_scale=data_manager.eval_ate_correct_scale,
        gt_traj3d=data_manager.gt_traj3d,
        gt_timestamps=data_manager.gt_timestamps,
        gt_poses=data_manager.gt_poses,
        synced_gt=data_manager.synced_gt
    )

    runner = SlamRunner(config_obj, data_manager, viz_engine, camera, online_trajectory_writer)

    try:
        runner.run()
    except KeyboardInterrupt:
        Printer.yellow("\nCTRL+C detected. Shutting down ...\n")
        force_kill_all_and_exit(verbose=False)
        sys.exit(0)

    if online_trajectory_writer:
        online_trajectory_writer.close_file()

    try:
        est_poses, timestamps, ids = runner.slam.get_final_trajectory()
        is_final = not data_manager.dataset.is_ok
        if data_manager.has_groundtruth:
            assoc_timestamps, assoc_est_poses, assoc_gt_poses = find_poses_associations(
                timestamps, est_poses, data_manager.gt_timestamps, data_manager.gt_poses
            )
            ape_stats, T_gt_est = eval_ate(
                poses_est=assoc_est_poses,
                poses_gt=assoc_gt_poses,
                frame_ids=ids,
                curr_frame_id=runner.img_id,
                is_final=is_final,
                is_monocular=data_manager.eval_ate_correct_scale,
                save_dir=metrics_save_dir,
            )
            Printer.green(f"EVO stats: {json.dumps(ape_stats, indent=4)}")
        else:
            Printer.yellow("Ground truth not available: skipping trajectory evaluation")

        if final_trajectory_writer:
            final_trajectory_writer.write_full_trajectory(est_poses, timestamps)
            final_trajectory_writer.close_file()

        other_metrics_file_path = os.path.join(metrics_save_dir, "other_metrics_info.txt")
        if other_metrics_file_path:
            with open(other_metrics_file_path, "w") as f:
                f.write(f"num_total_frames: {data_manager.num_total_frames}\n")
                f.write(f"num_processed_frames: {runner.num_frames}\n")
                f.write(f"num_lost_frames: {runner.num_tracking_lost}\n")
                f.write(f"percent_lost: {runner.num_tracking_lost/data_manager.num_total_frames*100:.2f}\n")

        evaluate_semantic_mapping(runner.slam, data_manager.dataset, metrics_save_dir)

    except Exception as e:
        print("Exception while computing metrics: ", e)
        print(f"traceback: {traceback.format_exc()}")

    runner.slam.quit()
    time.sleep(0.5)

    viz_engine.quit()

    LoggerQueue.stop_all_instances()
    time.sleep(1.0)

    if config_obj.args.headless:
        force_kill_all_and_exit(verbose=False)
    else:
        if platform.system() == "Darwin" or mp.get_start_method() == "spawn":
            time.sleep(5.0)
            force_kill_all_and_exit(verbose=True)
