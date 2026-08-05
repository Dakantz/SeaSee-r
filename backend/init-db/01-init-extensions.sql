-- Enable PostGIS, pgPointcloud, pointcloud_postgis, and postgis_raster extensions automatically upon database initialization
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;
CREATE EXTENSION IF NOT EXISTS pointcloud;
CREATE EXTENSION IF NOT EXISTS pointcloud_postgis CASCADE;

