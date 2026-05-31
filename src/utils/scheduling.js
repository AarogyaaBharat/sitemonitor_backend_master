/**
 * Calculates the next scan date based on frequency, type, and time.
 * @param {number} frequency 
 * @param {string} type - 'day', 'week', 'month', 'quarter'
 * @param {string} time - 'HH:mm'
 * @param {Date} fromDate 
 * @returns {Date}
 */
export function calculateNextScanAt(frequency, type, time, fromDate = new Date()) {
    const next = new Date(fromDate);
    const freq = parseInt(frequency) || 1;
  
    switch (type) {
      case 'day':
        next.setDate(next.getDate() + freq);
        break;
      case 'week':
        next.setDate(next.getDate() + (freq * 7));
        break;
      case 'month':
        next.setMonth(next.getMonth() + freq);
        break;
      case 'quarter':
        next.setMonth(next.getMonth() + (freq * 3));
        break;
      default:
        next.setDate(next.getDate() + freq);
    }
  
    if (time) {
      const [hours, minutes] = time.split(':').map(Number);
      if (!isNaN(hours)) next.setHours(hours, minutes || 0, 0, 0);
    }
  
    return next;
  }
