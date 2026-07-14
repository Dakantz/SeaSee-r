import argparse
import json
from pyslam.config import Config
from pyslam.config_parameters import Parameters
from pyslam.local_features.feature_tracker_configs import FeatureTrackerConfigs
from pyslam.loop_closing.loop_detector_configs import LoopDetectorConfigs
from pyslam.semantics.semantic_mapping_configs import SemanticMappingConfigs
from pyslam.utilities.logging import Printer
from pyslam.utilities.serialization import SerializableEnumEncoder

class Configuration:
    def __init__(self):
        self.args = self._parse_args()
        self.config = Config(self.args.config_path) if self.args.config_path else Config()
        self.feature_tracker_config = None
        self.loop_detection_config = None
        self.semantic_mapping_config = None
        
    def _parse_args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument("-c", "--config_path", type=str, default=None, help="Optional path for custom configuration file")
        parser.add_argument("--no_output_date", action="store_true", help="Do not append date to output directory")
        parser.add_argument("--headless", action="store_true", help="Run in headless mode")
        return parser.parse_args()

    def setup_slam_configs(self, dataset_type):
        self.feature_tracker_config = FeatureTrackerConfigs.ORB2
        self.loop_detection_config = LoopDetectorConfigs.DBOW3
        self.semantic_mapping_config = (
            SemanticMappingConfigs.get_config_from_slam_dataset(dataset_type, Parameters.kSemanticSegmentationType)
            if Parameters.kDoSparseSemanticMappingAndSegmentation else None
        )

        if self.config.feature_tracker_config_name is not None:
            self.feature_tracker_config = FeatureTrackerConfigs.get_config_from_name(self.config.feature_tracker_config_name)
        if self.config.num_features_to_extract > 0:
            Printer.yellow("Setting feature_tracker_config num_features from settings: ", self.config.num_features_to_extract)
            self.feature_tracker_config["num_features"] = self.config.num_features_to_extract
        if self.config.loop_detection_config_name is not None:
            self.loop_detection_config = LoopDetectorConfigs.get_config_from_name(self.config.loop_detection_config_name)
        if self.config.semantic_mapping_config_name is not None:
            self.semantic_mapping_config = SemanticMappingConfigs.get_config_from_name(self.config.semantic_mapping_config_name)

        Printer.green("feature_tracker_config: ", json.dumps(self.feature_tracker_config, indent=4, cls=SerializableEnumEncoder))
        Printer.green("loop_detection_config: ", json.dumps(self.loop_detection_config, indent=4, cls=SerializableEnumEncoder))
        if Parameters.kDoSparseSemanticMappingAndSegmentation:
            Printer.green("semantic_mapping_config: ", json.dumps(self.semantic_mapping_config, indent=4, cls=SerializableEnumEncoder))

        self.config.feature_tracker_config = self.feature_tracker_config
        self.config.loop_detection_config = self.loop_detection_config
        self.config.semantic_mapping_config = self.semantic_mapping_config
