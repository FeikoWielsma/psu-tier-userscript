
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

USER root

# Copy the generated JS file
COPY --from=generator /app/psutier.user.js /usr/share/nginx/html/psutier.user.js

RUN echo '<h2>PSU Tier Userscript</h2><a href="psutier.user.js">Download Script</a>' > /usr/share/nginx/html/index.html

RUN chown -R 101:0 /usr/share/nginx/html && \
    chmod -R g+w /usr/share/nginx/html
    
USER 101

EXPOSE 8080