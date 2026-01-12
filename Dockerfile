# --- Stage 1: Build ---
FROM registry.access.redhat.com/ubi9/python-39 AS generator
USER 0
RUN dnf install -y nodejs && dnf clean all

WORKDIR /opt/app-root/src

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python fetch_sheet.py \
 && python parse_tier_list.py \
 && python generate_userscript.py --test

RUN node tests/test_matching.js

RUN chown -R 0:0 /opt/app-root/src \
 && chmod -R g+rwX /opt/app-root/src

# --- Stage 2: Nginx ---
FROM registry.access.redhat.com/ubi9/nginx-122-minimal

USER 0

COPY --from=generator /opt/app-root/src/psutier.user.js /opt/app-root/src/

RUN printf '%s\n' \
  '<h1>PSU Tier Userscript (V7)</h1>' \
  '<a href="psutier.user.js">Download Script</a>' \
  > /opt/app-root/src/index.html

RUN chown -R 0:0 /opt/app-root/src \
 && chmod -R g+rwX /opt/app-root/src

USER 1001
