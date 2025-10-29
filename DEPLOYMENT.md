# Sebestian Video Creator API - Deployment Guide

## Ubuntu VPS Deployment Instructions

This guide will help you deploy the Sebestian Video Creator API on an Ubuntu VPS.

## Prerequisites

- Ubuntu 18.04+ VPS with at least 2GB RAM
- Root or sudo access
- Domain name (optional, for production)

## Installation Steps

### 1. Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js (v18 or higher)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Verify installation
npm --version
```

### 3. Install FFmpeg and Required Fonts
```bash
# Install FFmpeg
sudo apt install -y ffmpeg

# Verify FFmpeg installation
ffmpeg -version

# Install DejaVu fonts (required for text overlay)
sudo apt install -y fonts-dejavu fonts-dejavu-core fonts-dejavu-extra

# Verify font installation
ls /usr/share/fonts/truetype/dejavu/
```

### 4. Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### 5. Clone/Upload Your Project
```bash
# Create app directory
sudo mkdir -p /var/www
cd /var/www

# Upload your project files or clone from git
# Option 1: Clone from git
git clone <your-repo-url> sebestian
# Option 2: Use SCP to upload
# scp -r ./Sebestian user@your-vps-ip:/var/www/sebestian

cd sebestian
```

### 6. Install Dependencies
```bash
npm install --production
```

### 7. Configure Environment
```bash
# Create .env file
nano .env
```

Add the following:
```env
PORT=5000
NODE_ENV=production
```

Save and exit (Ctrl+X, Y, Enter)

### 8. Create Temp Directory
```bash
mkdir -p temp
chmod 755 temp
```

### 9. Start Application with PM2
```bash
# Start the application
pm2 start app.js --name sebestian-api

# Save PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup
# Follow the command output instructions (it will give you a sudo command to run)
```

### 10. Configure Firewall
```bash
# Allow Node.js port
sudo ufw allow 5000/tcp

# If using Nginx as reverse proxy (recommended)
sudo ufw allow 'Nginx Full'

# Enable firewall
sudo ufw enable
sudo ufw status
```

## Nginx Reverse Proxy (Recommended for Production)

### 1. Install Nginx
```bash
sudo apt install -y nginx
```

### 2. Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/sebestian
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain or VPS IP

    # Increase client body size for large uploads
    client_max_body_size 100M;

    # Increase timeouts for long video processing
    proxy_read_timeout 600s;
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Enable Nginx Site
```bash
sudo ln -s /etc/nginx/sites-available/sebestian /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

### 4. Install SSL Certificate (Optional but Recommended)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## PM2 Management Commands

```bash
# View logs
pm2 logs sebestian-api

# View real-time logs
pm2 logs sebestian-api --lines 100

# Restart application
pm2 restart sebestian-api

# Stop application
pm2 stop sebestian-api

# Delete from PM2
pm2 delete sebestian-api

# View application status
pm2 status

# Monitor resources
pm2 monit
```

## API Endpoints

- **POST** `/api/ffmpeg/create-video` - Create video from audio files and image
- **GET** `/api/ffmpeg/create-video` - API documentation
- **GET** `/api/ffmpeg/storage-info` - Check temp storage usage
- **GET** `/health` - Health check endpoint
- **GET** `/` - API information

## Testing the API

### Basic Health Check
```bash
curl http://localhost:5000/health
```

### Create Video Test
```bash
curl --location 'http://localhost:5000/api/ffmpeg/create-video' \
--header 'Content-Type: application/json' \
--data '{
    "files": [
        "https://lalals.s3.amazonaws.com/conversions/standard/fabfe467-12bb-4504-ab69-4f7fc9f7ac22.mp3",
        "https://lalals.s3.amazonaws.com/conversions/standard/c8c6b449-d338-4696-97fd-6ee6ddbf8202.mp3"
    ],
    "imageUrl": "https://example.com/image.png",
    "vibe": "Ocean Breeze",
    "subtitle": "Lo Fi Focus Mix"
}' --output video.mp4
```

### Check Storage Usage
```bash
curl http://localhost:5000/api/ffmpeg/storage-info
```

## Monitoring & Maintenance

### 1. Set Up Log Rotation
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 2. Monitor Disk Space
```bash
# Check disk usage
df -h

# Check temp directory size
du -sh /var/www/sebestian/temp
```

### 3. Automated Cleanup
The application automatically cleans up:
- Old temp files (older than 1 hour) every 30 minutes
- Temp files on startup
- Temp files after video creation
- Temp files on graceful shutdown

### 4. Server Monitoring Script
Create a monitoring script:
```bash
nano /var/www/sebestian/monitor.sh
```

Add:
```bash
#!/bin/bash
echo "=== Server Status ==="
pm2 status
echo ""
echo "=== Disk Usage ==="
df -h /
echo ""
echo "=== Temp Directory Size ==="
du -sh /var/www/sebestian/temp
echo ""
echo "=== Storage Info ==="
curl -s http://localhost:5000/api/ffmpeg/storage-info | jq .
```

Make executable:
```bash
chmod +x /var/www/sebestian/monitor.sh
```

## Troubleshooting

### FFmpeg Not Found
```bash
# Install FFmpeg if missing
sudo apt install -y ffmpeg
```

### Font Errors
```bash
# Install required fonts
sudo apt install -y fonts-dejavu fonts-dejavu-core fonts-dejavu-extra

# Verify fonts
fc-list | grep -i dejavu
```

### Port Already in Use
```bash
# Find process using port 5000
sudo lsof -i :5000

# Kill process if needed
sudo kill -9 <PID>

# Restart application
pm2 restart sebestian-api
```

### Out of Memory
```bash
# Increase swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Application Crashes
```bash
# View logs
pm2 logs sebestian-api --lines 200

# Restart with auto-restart
pm2 restart sebestian-api --max-restarts 10
```

## Security Recommendations

1. **Firewall**: Only open necessary ports
2. **Fail2ban**: Install to prevent brute force attacks
   ```bash
   sudo apt install -y fail2ban
   ```
3. **Rate Limiting**: Consider adding rate limiting in Nginx
4. **API Keys**: Implement API key authentication for production
5. **HTTPS**: Always use SSL/TLS in production
6. **Updates**: Keep system and dependencies updated
   ```bash
   sudo apt update && sudo apt upgrade -y
   npm audit fix
   ```

## Performance Optimization

1. **Increase file descriptors**:
   ```bash
   echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
   echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
   ```

2. **Optimize Node.js**:
   ```bash
   # Start with increased memory
   pm2 start app.js --name sebestian-api --node-args="--max-old-space-size=2048"
   ```

3. **Enable Nginx caching** (optional):
   Add to Nginx config:
   ```nginx
   proxy_cache_path /tmp/nginx_cache levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;
   ```

## Backup Strategy

### 1. Backup Scripts
```bash
# Create backup directory
mkdir -p /backups

# Backup script
nano /var/www/sebestian/backup.sh
```

Add:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
APP_DIR="/var/www/sebestian"

# Backup application files
tar -czf $BACKUP_DIR/sebestian_$DATE.tar.gz $APP_DIR --exclude='node_modules' --exclude='temp'

# Keep only last 7 backups
find $BACKUP_DIR -name "sebestian_*.tar.gz" -mtime +7 -delete

echo "Backup completed: sebestian_$DATE.tar.gz"
```

### 2. Schedule Backups
```bash
chmod +x /var/www/sebestian/backup.sh
crontab -e
```

Add:
```
0 2 * * * /var/www/sebestian/backup.sh >> /var/log/backup.log 2>&1
```

## Support & Maintenance

For production deployments:
- Monitor logs regularly: `pm2 logs`
- Check storage usage: `GET /api/ffmpeg/storage-info`
- Monitor server resources: `pm2 monit`
- Keep dependencies updated: `npm audit` and `npm update`

## API Rate Limits (Recommended)

Consider implementing rate limiting for production:
```bash
npm install express-rate-limit
```

## Scaling Considerations

For high-traffic scenarios:
1. Use load balancer (Nginx or HAProxy)
2. Run multiple instances with PM2 cluster mode
3. Use external storage for temp files (S3, MinIO)
4. Implement job queue (Redis + Bull)
5. Use CDN for video delivery

---

**Last Updated**: October 2025
**Version**: 1.0.0
