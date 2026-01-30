#!/bin/bash

# API Monitoring Script
# Hits the Tender Gap Analyzer API every 30 seconds

# Configuration
API_URL="https://tender-intake.onrender.com/analyze"
DOCUMENT_PATH="/home/gaian/Downloads/6565dbb36c16dTenderdoc144.pdf"
DEPARTMENT="healthcare management"
CATEGORY="Works"  # Optional - can be empty string if not needed
INTERVAL=30  # seconds

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Starting API Monitor"
echo "   API URL: $API_URL"
echo "   Document: $DOCUMENT_PATH"
echo "   Department: $DEPARTMENT"
echo "   Category: $CATEGORY"
echo "   Interval: ${INTERVAL} seconds"
echo "   Press Ctrl+C to stop"
echo ""

# Check if file exists
if [ ! -f "$DOCUMENT_PATH" ]; then
    echo -e "${RED}❌ Error: Document file not found: $DOCUMENT_PATH${NC}"
    exit 1
fi

# Counter
COUNT=0

# Main loop
while true; do
    COUNT=$((COUNT + 1))
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "${YELLOW}[$TIMESTAMP] Request #$COUNT${NC}"
    
    # Make the API call
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        --location --request POST "$API_URL" \
        --form "document=@\"$DOCUMENT_PATH\"" \
        --form "department=\"$DEPARTMENT\"" \
        --form "category=\"$CATEGORY\"" \
        2>&1)
    
    # Extract HTTP status code (last line)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    # Extract response body (all but last line)
    BODY=$(echo "$RESPONSE" | head -n-1)
    
    # Check response
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo -e "${GREEN}✓ Success (HTTP $HTTP_CODE)${NC}"
        
        # Extract score if available
        SCORE=$(echo "$BODY" | grep -o '"overallScore":[0-9]*' | grep -o '[0-9]*' || echo "N/A")
        if [ "$SCORE" != "N/A" ]; then
            echo -e "   Score: ${GREEN}$SCORE/100${NC}"
        fi
        
        # Extract filename
        FILENAME=$(echo "$BODY" | grep -o '"filename":"[^"]*"' | cut -d'"' -f4 || echo "N/A")
        if [ "$FILENAME" != "N/A" ]; then
            echo -e "   File: $FILENAME"
        fi
    else
        echo -e "${RED}✗ Failed (HTTP $HTTP_CODE)${NC}"
        echo "   Response: $BODY" | head -c 200
        echo ""
    fi
    
    echo ""
    
    # Wait before next request
    sleep $INTERVAL
done
