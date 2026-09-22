import os
import logging
import yaml
from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.opensfm import OpenSfMConfig, OpenSfMConfigResponse, OpenSfMConfigUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/opensfm", tags=["OpenSfM"])

DEFAULT_CONFIG_YAML = """# OpenSfM Configuration (Target: 10-16 GB Memory Usage)
processes: 2

feature_process_size: 2048
mem_ceiling: 12288

depthmap_max_image_size: 2048
depthmap_cluster_max_size: 12
depthmap_max_cluster_views: 32
depthmap_fusion_svo_max_voxels: 50000000

undistorted_image_max_size: 2048
undistorted_image_format: png
submodel_size: 60
"""

def get_resolved_config_path() -> Path:
    path = Path(settings.opensfm_config)
    if path.is_absolute():
        return path

    if path.exists():
        return path.resolve()

    backend_dir = Path(__file__).resolve().parents[3]
    parts = path.parts
    if parts and parts[0] == "backend":
        rel_path = Path(*parts[1:])
    else:
        rel_path = path

    return (backend_dir / rel_path).resolve()

def load_yaml_dict(raw_yaml: str) -> dict:
    try:
        data = yaml.safe_load(raw_yaml)
        if data is None:
            return {}
        if not isinstance(data, dict):
            raise ValueError("YAML content must resolve to a key-value dictionary.")
        return data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid YAML content: {e}"
        )

def parse_yaml_to_model(content: str) -> OpenSfMConfig:
    try:
        data = yaml.safe_load(content) or {}
    except Exception as e:
        logger.warning(f"Error parsing YAML content: {e}")
        data = {}

    default_dict = OpenSfMConfig().model_dump()
    if isinstance(data, dict):
        for k, v in data.items():
            if k in default_dict:
                default_dict[k] = v

    try:
        return OpenSfMConfig.model_validate(default_dict)
    except ValidationError as ve:
        logger.warning(f"Validation warning when parsing OpenSfM config: {ve}")
        return OpenSfMConfig()

def save_config_text(config_path: Path, content: str) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(config_path.parent, 0o777)
    except Exception:
        pass
    config_path.write_text(content, encoding="utf-8")
    try:
        os.chmod(config_path, 0o666)
    except Exception:
        pass

@router.get("/config", response_model=OpenSfMConfigResponse, name="get_opensfm_config")
async def get_opensfm_config():
    """
    Get current OpenSfM configuration parameters and raw YAML content.
    """
    config_path = get_resolved_config_path()
    if not config_path.exists():
        save_config_text(config_path, DEFAULT_CONFIG_YAML)

    try:
        raw_yaml = config_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Error reading OpenSfM config file at {config_path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not read OpenSfM configuration file: {e}"
        )

    parsed_config = parse_yaml_to_model(raw_yaml)
    return OpenSfMConfigResponse(
        config=parsed_config,
        raw_yaml=raw_yaml,
        file_path=str(settings.opensfm_config)
    )

@router.put("/config", response_model=OpenSfMConfigResponse, name="update_opensfm_config")
async def update_opensfm_config(payload: OpenSfMConfigUpdate):
    """
    Update OpenSfM configuration via structured model or raw YAML.
    """
    config_path = get_resolved_config_path()

    if payload.raw_yaml is not None:
        raw_yaml = payload.raw_yaml
        data_dict = load_yaml_dict(raw_yaml)
        try:
            parsed_config = parse_yaml_to_model(raw_yaml)
            temp_dict = parsed_config.model_dump()
            temp_dict.update({k: v for k, v in data_dict.items() if k in temp_dict})
            validated_config = OpenSfMConfig.model_validate(temp_dict)
        except ValidationError as ve:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Configuration validation failed: {ve}"
            )
        parsed_config = validated_config
    elif payload.config is not None:
        parsed_config = payload.config
        existing_yaml = ""
        if config_path.exists():
            try:
                existing_yaml = config_path.read_text(encoding="utf-8")
            except Exception:
                pass
        
        try:
            data_dict = yaml.safe_load(existing_yaml) if existing_yaml else {}
            if not isinstance(data_dict, dict):
                data_dict = {}
        except Exception:
            data_dict = {}

        new_fields = parsed_config.model_dump()
        data_dict.update(new_fields)
        raw_yaml = yaml.safe_dump(data_dict, sort_keys=False)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'config' or 'raw_yaml' must be provided."
        )

    try:
        save_config_text(config_path, raw_yaml)
    except Exception as e:
        logger.error(f"Error writing OpenSfM config file at {config_path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save OpenSfM configuration file: {e}"
        )

    return OpenSfMConfigResponse(
        config=parsed_config,
        raw_yaml=raw_yaml,
        file_path=str(settings.opensfm_config)
    )

@router.post("/config/reset", response_model=OpenSfMConfigResponse, name="reset_opensfm_config")
async def reset_opensfm_config():
    """
    Reset OpenSfM configuration to default values.
    """
    config_path = get_resolved_config_path()
    try:
        save_config_text(config_path, DEFAULT_CONFIG_YAML)
    except Exception as e:
        logger.error(f"Error resetting OpenSfM config file at {config_path}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not reset OpenSfM configuration file: {e}"
        )

    parsed_config = parse_yaml_to_model(DEFAULT_CONFIG_YAML)
    return OpenSfMConfigResponse(
        config=parsed_config,
        raw_yaml=DEFAULT_CONFIG_YAML,
        file_path=str(settings.opensfm_config)
    )

