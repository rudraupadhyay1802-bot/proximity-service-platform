FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential libsqlite3-dev zlib1g-dev ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe && cd /tmp/tippecanoe && make -j4 && make install && rm -rf /tmp/tippecanoe
WORKDIR /work
