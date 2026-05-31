import axios from 'axios';

async function check() {
  try {
    const r = await axios.head('https://jewellmaster.com/', { timeout: 10000, maxRedirects: 5, validateStatus: () => true });
    console.log('HTTPS Status:', r.status);
    console.log('HTTPS Redirects to:', r.headers.location);
  } catch (e) {
    console.log('HTTPS Error:', e.message);
  }

  try {
    const r = await axios.head('http://jewellmaster.com/', { timeout: 10000, maxRedirects: 5, validateStatus: () => true });
    console.log('HTTP Status:', r.status);
    console.log('HTTP Redirects to:', r.headers.location);
  } catch (e) {
    console.log('HTTP Error:', e.message);
  }
}

check();
