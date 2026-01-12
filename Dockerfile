# --- Stage 1: The Builder (Python) ---
FROM python:3.9-slim AS generator
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and run the generation scripts
COPY . .
RUN python fetch_sheet.py && \
    python parse_tier_list.py && \
    python generate_userscript.py
# --- Stage 2: The Host (Nginx) ---
FROM docker.io/nginxinc/nginx-unprivileged:alpine

# Temporarily switch to root to set up files
USER root

# Copy the generated .js file from Stage 1 to the web folder
COPY --from=generator /app/psutier.user.js /usr/share/nginx/html/psutier.user.js

# Create a simple download page
RUN echo '<h1>PSU Tier Userscript V4</h1><a href="psutier.user.js">Download Script</a>' > /usr/share/nginx/html/index.html

# OpenShift runs containers with a random User ID in Group 0.
# We must ensure Group 0 can read/write the web folder.
RUN chown -R 101:0 /usr/share/nginx/html && \
    chmod -R g+w /usr/share/nginx/html
USER 101

EXPOSE 8080
