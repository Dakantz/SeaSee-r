-- Enable PostGIS, pgPointcloud, and pointcloud_postgis extensions automatically upon database initialization
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pointcloud;
CREATE EXTENSION IF NOT EXISTS pointcloud_postgis CASCADE;
