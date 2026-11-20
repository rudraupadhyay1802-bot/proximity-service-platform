"""
02_dem_generator.py
Generates a 30m resolution DEM GeoTIFF covering the Navrangpura study area,
referenced in EPSG:4326, with elevation values reflecting Ahmedabad's
Sabarmati river plain (48m to 56m elevation).
"""

import os
import pyproj
os.environ['PROJ_DATA'] = pyproj.datadir.get_data_dir()
os.environ['PROJ_LIB'] = pyproj.datadir.get_data_dir()

import numpy as np
import rasterio
from rasterio.transform import from_bounds
import json

with open('data/study_area.geojson') as f:
    area_data = json.load(f)

# Extent of the study area with 500m margin
min_lon, min_lat = 72.535, 23.015
max_lon, max_lat = 72.585, 23.060

# 30m resolution in degrees (~0.00027 degrees)
res = 0.00027
width = int((max_lon - min_lon) / res)
height = int((max_lat - min_lat) / res)

transform = from_bounds(min_lon, min_lat, max_lon, max_lat, width, height)

# Generate realistic elevation surface:
# Topography slopes from 56m in the north-west towards 48m near the Sabarmati river in the east
x = np.linspace(0, 1, width)
y = np.linspace(0, 1, height)
xx, yy = np.meshgrid(x, y)

# Elevation formula: baseline 52m, + 3m from NW, - 3m towards river, + small microtopography
np.random.seed(42)
elevation = 54.0 - 5.0 * xx + 3.0 * yy + 0.5 * np.sin(xx * 10) * np.cos(yy * 10)
elevation = elevation.astype(np.float32)

output_dem_path = 'data/navrangpura_dem.tif'

with rasterio.open(
    output_dem_path,
    'w',
    driver='GTiff',
    height=height,
    width=width,
    count=1,
    dtype=elevation.dtype,
    crs='EPSG:4326',
    transform=transform,
) as dst:
    dst.write(elevation, 1)

print(f"Generated DEM GeoTIFF at {output_dem_path}: {width}x{height} pixels, CRS=EPSG:4326, min={elevation.min():.1f}m, max={elevation.max():.1f}m")
