#!/bin/bash

# Sebestian Video Creator - Ubuntu VPS Deployment Script
# This script sets up the application on Ubuntu VPS

echo "🚀 Starting Sebestian Video Creator deployment..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js (using NodeSource repository for latest LTS)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install system dependencies for FFmpeg
echo "📦 Installing system dependencies..."
sudo apt-get install -y build-essential
sudo apt-get install -y libfontconfig1 libfontconfig1-dev

# Create application directory
echo "📁 Setting up application directory..."
sudo mkdir -p /opt/sebestian
sudo chown $USER:$USER /opt/sebestian

# Copy application files (assuming you're running this from the project directory)
echo "📁 Copying application files..."
cp -r . /opt/sebestian/
cd /opt/sebestian

# Install application dependencies
echo "📦 Installing application dependencies..."
npm install --production

# Create PM2 ecosystem file
echo "⚙️ Creating PM2 configuration..."
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'sebestian',
    script: 'app.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Create systemd service for PM2
echo "⚙️ Creating systemd service..."
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER

# Start the application with PM2
echo "🚀 Starting application..."
pm2 start ecosystem.config.js
pm2 save

# Setup firewall (if ufw is available)
echo "🔥 Configuring firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 5000/tcp
    sudo ufw --force enable
fi

# Create temp directory with proper permissions
echo "📁 Setting up temp directory..."
mkdir -p temp
chmod 755 temp

echo "✅ Deployment completed successfully!"
echo ""
echo "📊 Application Status:"
pm2 status
echo ""
echo "🌐 Your application is running on: http://your-server-ip:5000"
echo "📝 API Endpoint: http://your-server-ip:5000/api/ffmpeg/create-video"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status          - Check application status"
echo "  pm2 logs sebestian  - View application logs"
echo "  pm2 restart sebestian - Restart application"
echo "  pm2 stop sebestian   - Stop application"
echo "  pm2 delete sebestian - Remove application from PM2"
echo ""
echo "📁 Application directory: /opt/sebestian"
echo "📝 Logs directory: /opt/sebestian/logs"
