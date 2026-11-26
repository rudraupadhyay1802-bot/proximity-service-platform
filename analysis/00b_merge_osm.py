import xml.etree.ElementTree as ET

# Chunk 3: merge the 16 tile files into one OSM file

NUM_TILES = 16

nodes = {}
ways = {}
dup_nodes = 0
dup_ways = 0

for i in range(NUM_TILES):
    filename = "data/osm_tile_" + str(i) + ".osm"
    tree = ET.parse(filename)
    root = tree.getroot()

    for n in root.findall("node"):
        nid = n.attrib["id"]
        if nid in nodes:
            dup_nodes = dup_nodes + 1
        else:
            nodes[nid] = n

    for w in root.findall("way"):
        wid = w.attrib["id"]
        if wid in ways:
            dup_ways = dup_ways + 1
        else:
            ways[wid] = w

    print("Tile", i, "done. Unique nodes so far:", len(nodes), "ways:", len(ways))

merged = ET.Element("osm", version="0.6")
merged.append(ET.Element("bounds", minlat="23.007", minlon="72.526", maxlat="23.069", maxlon="72.594"))
for nid in nodes:
    merged.append(nodes[nid])
for wid in ways:
    merged.append(ways[wid])

ET.ElementTree(merged).write("data/raw_osm_buffered.osm", encoding="utf-8", xml_declaration=True)
print("Wrote data/raw_osm_buffered.osm")
print("Duplicate nodes skipped:", dup_nodes, " duplicate ways skipped:", dup_ways)
