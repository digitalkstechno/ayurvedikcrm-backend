const axios = require('axios');
const crypto = require('crypto');

// Facebook requires sha256 hashed data
const hashData = (data) => {
    if (!data) return undefined;
    return crypto.createHash('sha256').update(String(data).trim().toLowerCase()).digest('hex');
};

const sendLeadEventToFacebook = async (customerDetails) => {
    const PIXEL_ID = '1477122113527557';
    // Using environment variable for security, fallback to provided token
    const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || 'EAAhfrByHy1ABRZB7jWGrWdYuyPkF4Y89kb3gZBz8ctIRTTnjbD4VnZCuYwuqHZANY4mMpy6O4dfehwPZCmObItSwGfrvElggHBhCki73stg4M89fnlt7WuHZB17JdK7vPVOUgWV3GUGtYCo57LiTNR7pJKqe41XREw8joxijN2dlPTW2wPCnFh1xYyKKVOZCwZDZD';
    
    const url = `https://graph.facebook.com/v25.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

    const userData = {};
    if (customerDetails.email) userData.em = [hashData(customerDetails.email)];
    if (customerDetails.phone) userData.ph = [hashData(customerDetails.phone)];

    const payload = {
        data: [
            {
                action_source: "system_generated",
                custom_data: {
                    event_source: "crm",
                    lead_event_source: "Your CRM"
                },
                event_name: "Lead",
                event_time: Math.floor(Date.now() / 1000),
                user_data: userData
            }
        ]
    };

    try {
        const response = await axios.post(url, payload);
        console.log('✅ Lead successfully sent to Facebook CAPI:', response.data);
    } catch (error) {
        console.error('❌ Error sending to Facebook CAPI:', error.response ? error.response.data : error.message);
    }
};

module.exports = { sendLeadEventToFacebook };
