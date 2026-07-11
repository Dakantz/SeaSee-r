import os
import cv2
import numpy as np
import json
from pyslam.utilities.logging import Printer

class StateSaver:
    def __init__(self, config, data_manager):
        self.config = config
        self.data_manager = data_manager
        self.save_count = 0

    def save_map(self, slam):
        self.save_count += 1
        save_path = os.path.join(self.config.system_state_folder_path, f"save_{self.save_count}")
        if not os.path.exists(save_path):
            os.makedirs(save_path, exist_ok=True)
            
        #SLAM State
        slam.save_system_state(save_path)
        self.data_manager.dataset.save_info(save_path)
        if self.data_manager.has_groundtruth:
            self.data_manager.groundtruth.save(save_path)

        #Georeferencing info
        try:
            map_state = slam.map.get_data_arrays_for_drawing(100000, 10)
        except AttributeError:
            map_state = slam.map.get_state(get_covisibility_graph=True)      
        with open(os.path.join(save_path, "georeferencing_dataset.gcp"), "w") as f:
            f.write("WGS84 UTM 32N\n")
            if hasattr(map_state, 'points') and map_state.points is not None:
                for pt in map_state.points:
                    f.write(f"{pt[0]} {pt[1]} {pt[2]}\n")

        #Keyframes, Features, and Exif
        images_path = os.path.join(save_path, "images")
        features_path = os.path.join(save_path, "features")
        exif_path = os.path.join(save_path, "exif")
        os.makedirs(images_path, exist_ok=True)
        os.makedirs(features_path, exist_ok=True)
        os.makedirs(exif_path, exist_ok=True)

        images_path_all = os.path.join(self.config.system_state_folder_path, f"save_all", "images")
        features_path_all = os.path.join(self.config.system_state_folder_path, f"save_all", "features")
        exif_path_all = os.path.join(self.config.system_state_folder_path, f"save_all", "exif")
        os.makedirs(images_path_all, exist_ok=True)
        os.makedirs(features_path_all, exist_ok=True)
        os.makedirs(exif_path_all, exist_ok=True)

        for kf in slam.map.get_keyframes():
            if kf.img is not None:
                img_name = f"{kf.id:06d}.png"
                cv2.imwrite(os.path.join(images_path, img_name), kf.img)
                cv2.imwrite(os.path.join(images_path_all, img_name), kf.img)
                
                height, width = kf.img.shape[:2]
                
                # Export Exif metadata
                exif_data = {
                    "make": "unknown",
                    "model": "unknown",
                    "width": width,
                    "height": height,
                    "projection_type": "perspective",
                    "focal_ratio": 0.0,
                    "orientation": 1,
                    "capture_time": getattr(kf, 'timestamp', 0.0),
                    "gps": {},
                    "camera": f"v2 unknown unknown {width} {height} perspective 0.0"
                }
                
                with open(os.path.join(exif_path, img_name + ".exif"), "w") as f:
                    json.dump(exif_data, f, indent=4)
                with open(os.path.join(exif_path_all, img_name + ".exif"), "w") as f:
                    json.dump(exif_data, f, indent=4)
                
                # Export features
                if hasattr(kf, 'kps') and kf.kps is not None and len(kf.kps) > 0:
                    size = max(width, height)
                    
                    # Normalize points for OpenSfM: (x + 0.5 - width / 2.0) / size
                    p = np.zeros((len(kf.kps), 4), dtype=np.float32)
                    p[:, 0] = (kf.kps[:, 0] + 0.5 - width / 2.0) / size
                    p[:, 1] = (kf.kps[:, 1] + 0.5 - height / 2.0) / size
                    
                    # Descriptors
                    if kf.des is not None:
                        if kf.des.shape[1] < 128:
                            desc = np.zeros((len(kf.kps), 128), dtype=kf.des.dtype)
                            desc[:, :kf.des.shape[1]] = kf.des
                        else:
                            desc = kf.des
                    else:
                        desc = np.zeros((len(kf.kps), 128), dtype=np.uint8)
                    
                    # Extract colors from image
                    kps_int = np.round(kf.kps).astype(int)
                    kps_int[:, 0] = np.clip(kps_int[:, 0], 0, width - 1)
                    kps_int[:, 1] = np.clip(kps_int[:, 1], 0, height - 1)
                    if len(kf.img.shape) == 3:
                        colors = kf.img[kps_int[:, 1], kps_int[:, 0], ::-1] # BGR to RGB
                    else:
                        colors = np.repeat(kf.img[kps_int[:, 1], kps_int[:, 0]][:, None], 3, axis=1)
                    
                    obj = {
                        "OPENSFM_FEATURES_VERSION": 3,
                        "points": p,
                        "descriptors": desc,
                        "colors": colors,
                        "segmentations": [],
                        "instances": [],
                        "segmentation_labels": [],
                    }
                    
                    np.savez_compressed(os.path.join(features_path, img_name + ".features.npz"), **obj)
                    np.savez_compressed(os.path.join(features_path_all, img_name + ".features.npz"), **obj)
                
        Printer.blue(f"\nState saved in {save_path}")
        Printer.blue("uncheck pause checkbox on GUI to continue...\n")
