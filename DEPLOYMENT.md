# Deployment Guide

## Build and Start Commands

### Build Command
Since this is a Node.js application with no compilation step, the build command simply installs dependencies:

```bash
npm install
```

**For production:**
```bash
npm ci --production
```

### Start Command
```bash
npm start
```

**Or directly:**
```bash
node tender-gap-analyzer.js
```

## Environment Variables

You can configure the server using environment variables:

- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `OLLAMA_ENABLED` - Enable/disable AI features (default: true)

**Example:**
```bash
PORT=8080 HOST=0.0.0.0 npm start
```

## Deployment Platforms

### 1. Heroku

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

**Procfile:**
```
web: node tender-gap-analyzer.js
```

**Environment Variables (set in Heroku dashboard):**
- `PORT` (automatically set by Heroku)
- `OLLAMA_ENABLED=true` (optional)

### 2. Railway

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

### 3. Render

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

**Environment Variables:**
- `PORT` (automatically set by Render)
- `OLLAMA_ENABLED=true` (optional)

### 4. DigitalOcean App Platform

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

### 5. AWS EC2 / VPS (PM2)

**Install PM2:**
```bash
npm install -g pm2
```

**Start with PM2:**
```bash
pm2 start tender-gap-analyzer.js --name tender-gap-analyzer
```

**PM2 Ecosystem File (ecosystem.config.js):**
```javascript
module.exports = {
  apps: [{
    name: 'tender-gap-analyzer',
    script: './tender-gap-analyzer.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '0.0.0.0',
      OLLAMA_ENABLED: 'true'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
```

**Start with ecosystem file:**
```bash
pm2 start ecosystem.config.js
```

**Useful PM2 commands:**
```bash
pm2 list              # List all processes
pm2 logs              # View logs
pm2 restart all       # Restart all processes
pm2 stop all          # Stop all processes
pm2 delete all        # Delete all processes
pm2 save              # Save current process list
pm2 startup           # Generate startup script
```

### 6. Docker

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "tender-gap-analyzer.js"]
```

**Build Docker image:**
```bash
docker build -t tender-gap-analyzer .
```

**Run Docker container:**
```bash
docker run -d \
  -p 3000:3000 \
  -e PORT=3000 \
  -e OLLAMA_ENABLED=true \
  --name tender-gap-analyzer \
  tender-gap-analyzer
```

**Docker Compose (docker-compose.yml):**
```yaml
version: '3.8'

services:
  tender-gap-analyzer:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - OLLAMA_ENABLED=true
    volumes:
      - ./uploads:/app/uploads
      - ./Tender_Keywords_56_Rows_FULL.xlsx:/app/Tender_Keywords_56_Rows_FULL.xlsx
    restart: unless-stopped
```

**Start with Docker Compose:**
```bash
docker-compose up -d
```

## Required Files

Make sure these files are present in your deployment:

1. `tender-gap-analyzer.js` - Main application file
2. `package.json` - Dependencies
3. `Tender_Keywords_56_Rows_FULL.xlsx` - Keywords Excel file (in same directory)
4. `uploads/` directory - Will be created automatically for file uploads

## Health Check

After deployment, verify the server is running:

```bash
curl http://your-server:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "Tender Gap Analyzer API is running"
}
```

## Production Checklist

- [ ] All dependencies installed (`npm install`)
- [ ] Excel keywords file (`Tender_Keywords_56_Rows_FULL.xlsx`) is present
- [ ] `uploads/` directory has write permissions
- [ ] Environment variables are set (if needed)
- [ ] Port is accessible (firewall rules)
- [ ] Ollama API URL is accessible (if using AI features)
- [ ] Server is running and responding to health checks

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=8080 npm start
```

### Permission Denied
```bash
# Make sure the file is executable
chmod +x tender-gap-analyzer.js

# Or run with node explicitly
node tender-gap-analyzer.js
```

### Excel File Not Found
Make sure `Tender_Keywords_56_Rows_FULL.xlsx` is in the same directory as `tender-gap-analyzer.js`

### Uploads Directory Issues
The `uploads/` directory is created automatically, but if you have permission issues:
```bash
mkdir -p uploads
chmod 755 uploads
```
