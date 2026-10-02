// Requires Node.js v18+ which has built-in fetch
async function fetchStashTab() {
    // Your POESESSID
    const poesessid = '3c52b65354f73ff314dd53fa44e2893f';
    
    // Your stash URL parameters
    const accountName = 'jpitty#6741';
    const realm = 'pc';
    const league = 'Phrecia';
    const tabIndex = 27;
    
    // Create URL with parameters
    const url = new URL('https://www.pathofexile.com/character-window/get-stash-items');
    url.searchParams.append('accountName', accountName);
    url.searchParams.append('realm', realm);
    url.searchParams.append('league', league);
    url.searchParams.append('tabs', '0');
    url.searchParams.append('tabIndex', tabIndex.toString());
    
    try {
      const response = await fetch(url, {
        headers: {
          'Cookie': `POESESSID=${poesessid}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.pathofexile.com/'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`Successfully retrieved stash tab data with ${data.items.length} items`);
      
      return data;
    } catch (error) {
      console.error('Error fetching stash tab:', error.message);
      throw error;
    }
  }
  
fetchStashTab()
    .then(data => {
        // Process your stash data here
        console.log('Items in tab:');
        data.items.forEach(item => {
        console.log(`- ${item.baseType || item.typeLine} (${item.x},${item.y})`);
        });
    })
    .catch(console.error);
