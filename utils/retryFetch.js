const fetch = require("node-fetch");
const { AbortController } = require("node-abort-controller");

/**
 * Fetches a URL with retry logic and timeout handling
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options (headers, etc.)
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} timeout - Request timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>} - The fetch response
 */
async function retryFetch(url, options = {}, maxRetries = 3, timeout = 30000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // If response is successful, return it
            if (response.ok) {
                return response;
            }
            
            // If we get a non-ok response, throw an error
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            
        } catch (error) {
            clearTimeout(timeoutId);
            lastError = error;
            
            // Log the error
            console.error(`❌ Fetch attempt ${attempt}/${maxRetries} failed for ${url}:`, error.message);
            
            // Don't retry on certain errors
            if (error.message.includes('HTTP 4')) {
                console.error(`❌ Client error (4xx), not retrying: ${error.message}`);
                throw error;
            }
            
            // If this was the last attempt, throw the error
            if (attempt === maxRetries) {
                console.error(`❌ All ${maxRetries} fetch attempts failed for ${url}`);
                throw error;
            }
            
            // Calculate exponential backoff delay
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            console.log(`⏳ Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

module.exports = {
    retryFetch
};
