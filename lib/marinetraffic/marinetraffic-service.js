'use strict';

const rp = require('request-promise-native');
const cheerio = require('cheerio');

module.exports = class MarineTrafficService {
	async getLatestPositionTime(mmsi) {
		const url = `http://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}/`;

		try {
			const html = await rp(url);
			if (html.statusCode !== 404) {
				return new Date(2010,1,1);
			}
			// Utilize the cheerio library on the returned html which will essentially give us jQuery functionality
			const $ = cheerio.load(html);
			const timeUTC = $('time').eq(1).attr('datetime');
			return new Date(`${timeUTC} UTC`);
		} catch (error) {
			console.error('Error loading to Marine Traffic url:', error);
			//throw error;
		}
	}
};
