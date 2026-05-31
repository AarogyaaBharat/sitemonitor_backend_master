import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(process.env.LOG_DIR || 'logs', 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
});

const consoleFormat = winston.format.combine(
  winston.format.splat(),
  winston.format.printf(({ level, message, ...meta }) => {
    const icons = {
      info: 'ℹ️',
      error: '❌',
      warn: '⚠️',
      debug: '🔍',
    };
    
    // ANSI color codes
    const colors = {
      info: '\x1b[32m',  // Green
      error: '\x1b[31m', // Red
      warn: '\x1b[33m',  // Yellow
      debug: '\x1b[36m', // Cyan
      reset: '\x1b[0m',
    };

    // Clean level from any potential color codes and normalize
    const cleanLevel = level.replace(/\u001b\[[0-9;]*m/g, '').toLowerCase().trim();
    const icon = icons[cleanLevel] || '➡️';
    const color = colors[cleanLevel] || '';
    const reset = color ? colors.reset : '';
    
    // Handle metadata
    let metaStr = '';
    if (Object.keys(meta).length) {
      const { timestamp, ...rest } = meta;
      if (Object.keys(rest).length) {
        metaStr = ` ${JSON.stringify(rest)}`;
      }
    }
    
    // Apply color to the entire line for info, or just the level for others
    if (cleanLevel === 'info') {
      return `${icon} ${color}${cleanLevel}: ${message}${metaStr}${reset}`;
    }
    
    return `${icon} ${color}${cleanLevel}${reset}: ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

if (process.env.GENERATE_LOG_FILE === 'true') {
  logger.add(dailyRotateFileTransport);
}
