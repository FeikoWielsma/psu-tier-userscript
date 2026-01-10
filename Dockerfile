
FROM python:3.9-slim AS generator
WORKDIR /app


# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Run the generation chain
# (Assuming these scripts don't require interactive login)
RUN python fetch_sheet.py && \
    python parse_tier_list.py && \
    python generate_userscript.py

# --- Stage 2: Serve the File ---
# We use an unprivileged Nginx image (safe for OpenShift)
FROM nginxinc/nginx-unprivileged:alpine

# Copy the generated JS file from Stage 1 to the Nginx web root
COPY --from=generator /app/psutier.user.js /usr/share/nginx/html/psutier.user.js

# Optional: Create a simple index.html so you can click to download
RUN echo '<h1>PSU Tier Userscript</h1><a href="psutier.user.js">Download Script</a>' > /usr/share/nginx/html/index.html

# OpenShift runs containers on random ports, but Nginx Unprivileged listens on 8080 by default.
EXPOSE 8080