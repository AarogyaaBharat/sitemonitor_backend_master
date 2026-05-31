# SEO Scanner Service

A high-scale, fault-tolerant Node.js microservice designed to perform deep SEO analysis on millions of pages.

## Features
- **Scalable Job Queue**: Powered by BullMQ and Redis with smart retry logic and concurrency limits.
- **Deep Technical SEO**: Uses Puppeteer and Lighthouse to analyze Core Web Vitals, accessibility, and standard SEO markers.
- **Multi-Tenant MongoDB**: Connects to multiple client databases to discover domains flagged for scanning.
- **API Documentation**: Interactive Swagger UI at `/api-docs`.
- **Queue Monitoring**: Visual dashboard for job management at `/admin/queues`.
- **Production-Ready Logging**: Winston with daily log rotation.

## Tech Stack
- Node.js 20+ (ESM)
- Express.js
- Mongoose
- BullMQ + Redis
- Puppeteer + Lighthouse
- Swagger

## Setup Instructions

### 1. Installation
```bash
cd seo-scanner-service
npm install
```

### 2. Configuration
Copy `.env.example` to `.env` and fill in your connection strings.
```bash
cp .env.example .env
```

### 3. Running the Service
**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

## API Endpoints

- `POST /scan/trigger`: Scans all configured databases for pending domains and enqueues them.
- `POST /scan/domain`: Manually enqueues a single domain.
- `GET /jobs`: Lists current jobs in the queue.
- `GET /health`: Checks connectivity to Redis and MongoDB.

## Performance Tuning
The service is configured to run up to **3 simultaneous Puppeteer instances**. For higher throughput, increase `CONCURRENCY_LIMIT` in `.env` (requires more CPU/RAM).

## Graceful Shutdown
The service handles `SIGTERM` and `SIGINT` to ensure all active scans complete (or are gracefully paused), connections are closed, and no data is lost.
