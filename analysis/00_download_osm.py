import time
import urllib.request

# Chunk 1: work out the download area and split it into tiles

# Study area bbox is lon 72.538-72.582, lat 23.018-23.058.
# We add about 1.2 km on every side (0.011 deg lat, 0.012 deg lon).
WEST = 72.526
SOUTH = 23.007
EAST = 72.594
NORTH = 23.069

ROWS = 4
COLS = 4

lat_step = (NORTH - SOUTH) / ROWS
lon_step = (EAST - WEST) / COLS

tiles = []
for r in range(ROWS):
    for c in range(COLS):
        t_south = SOUTH + r * lat_step
        t_north = SOUTH + (r + 1) * lat_step
        t_west = WEST + c * lon_step
        t_east = WEST + (c + 1) * lon_step
        tiles.append((t_west, t_south, t_east, t_north))

print("Number of tiles:", len(tiles))
for t in tiles:
    print(t)

# Chunk 2: download each tile from the OSM API

HEADERS = {"User-Agent": "Ahmedabad-WebGIS-student-project/1.0 (https://github.com/rudraupadhyay1802-bot/proximity-service-platform)"}

for i in range(len(tiles)):
    t = tiles[i]
    bbox = str(round(t[0], 6)) + "," + str(round(t[1], 6)) + "," + str(round(t[2], 6)) + "," + str(round(t[3], 6))
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox
    filename = "data/osm_tile_" + str(i) + ".osm"
    print("Tile", i + 1, "of", len(tiles), bbox)

    request = urllib.request.Request(url, headers=HEADERS)
    try:
        response = urllib.request.urlopen(request, timeout=120)
        data = response.read()
        out = open(filename, "wb")
        out.write(data)
        out.close()
        print("  saved", len(data), "bytes")
    except Exception as e:
        print("  FAILED:", e)

    time.sleep(2)
