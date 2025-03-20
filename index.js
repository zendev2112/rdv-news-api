// Import the axios library
const axios = require('axios')

// Define the URL of the JSON data
const jsonUrl = 'https://rss.app/feeds/v1.1/_20zJLx8JIZ4cnqkE.json'

function fetchRSS(){
  // Fetch the JSON data
  axios
    .get(jsonUrl)
    .then((response) => {
      // Log the entire JSON data to the console
      console.log('Fetched JSON Data:', response.data)
    })

    .catch((error) => {
      // Handle any errors that occur during the request
      console.error('Error fetching JSON:', error)
    })
}

console.log(fetchRSS(jsonUrl));



