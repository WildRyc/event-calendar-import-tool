FROM nginx:alpine

COPY . /usr/share/nginx/html

RUN echo "=== FILES IN HTML DIR ===" && ls -la /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf