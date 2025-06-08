FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies, including devDependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Create uploads and logs directories
RUN mkdir -p uploads logs

# Create non-root user and set permissions
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /app

# Switch to the non-root user AFTER all installs
USER nodejs

# Expose port
EXPOSE 3000

# Run dev script
CMD ["npm", "run", "dev"]


