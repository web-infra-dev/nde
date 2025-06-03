#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting release process...${NC}"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}❌ Error: You must be on the main branch to release. Current branch: $CURRENT_BRANCH${NC}"
    exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}❌ Error: Working directory is not clean. Please commit or stash your changes.${NC}"
    exit 1
fi

# Pull latest changes
echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
pnpm install

# Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
pnpm test

# Build project
echo -e "${YELLOW}🔨 Building project...${NC}"
pnpm build

# Check for changesets
if [ ! "$(ls -A .changeset/*.md 2>/dev/null)" ]; then
    echo -e "${RED}❌ Error: No changesets found. Please create a changeset first using 'pnpm change'${NC}"
    exit 1
fi

# Show changeset status
echo -e "${YELLOW}📋 Changeset status:${NC}"
pnpm change-status

# Confirm release
echo -e "${YELLOW}❓ Do you want to proceed with the release? (y/N)${NC}"
read -r CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${RED}❌ Release cancelled.${NC}"
    exit 1
fi

# Version packages
echo -e "${YELLOW}📈 Versioning packages...${NC}"
pnpm bump

# Show what will be published
echo -e "${YELLOW}📋 About to publish:${NC}"
git log --oneline -n 5

# Final confirmation
echo -e "${YELLOW}❓ Ready to publish and push to GitHub? (y/N)${NC}"
read -r FINAL_CONFIRM
if [ "$FINAL_CONFIRM" != "y" ] && [ "$FINAL_CONFIRM" != "Y" ]; then
    echo -e "${RED}❌ Release cancelled.${NC}"
    exit 1
fi

# Publish to npm
echo -e "${YELLOW}📤 Publishing to npm...${NC}"
pnpm release

# Push to GitHub
echo -e "${YELLOW}🔗 Pushing to GitHub...${NC}"
git push origin main --follow-tags

# Create GitHub Release
echo -e "${YELLOW}📋 Creating GitHub Release...${NC}"
node scripts/create-github-release.js

echo -e "${GREEN}✅ Release completed successfully!${NC}"
echo -e "${GREEN}🎉 Check GitHub releases and npm for the new version.${NC}"
