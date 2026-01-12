# --- Stage 1: The Builder (Python) ---
FROM registry.access.redhat.com/ubi9/python-39 AS generator
USER 0
RUN dnf install -y nodejs && dnf clean all
USER 1001

WORKDIR /opt/app-root/src

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN python fetch_sheet.py && \
    python parse_tier_list.py && \
    python generate_userscript.py --test

RUN node tests/test_matching.js

# --- Stage 2: The Host (Nginx) ---
FROM registry.access.redhat.com/ubi9/nginx-122

USER root

COPY --from=generator --chown=1001:0 /opt/app-root/src/psutier.user.js /opt/app-root/src/psutier.user.js

USER 0
RUN echo '<h1>PSU Tier Userscript (UBI Version)</h1><a href="psutier.user.js">Download Script</a>' > /opt/app-root/src/index.html && \
    chown 1001:0 /opt/app-root/src/index.html && \
    chmod 644 /opt/app-root/src/index.htm
USER 1001