'use strict';

const xml2js = require('xml2js');
const moment = require('moment');
const sendgrid = require('sendgrid')(
	process.env.SENDGRID_API_KEY
);

const InReachService = require('./delorme/inreach-service');
const MarineTrafficService = require('./marinetraffic/marinetraffic-service');

const DEFAULT_REPORT_RECEIVER = 'report@marinetraffic.com';

/**
 * ServerAIS Class
 *
 * @type {module.ServerAIS}
 */
module.exports = class ServerAIS {
	async synchronize() {
		process.stdout.write('sync');
		const marinetraffic = new MarineTrafficService();

		try {
			const mmsi = this.getMMSI();
			const lastMTUpdate = await marinetraffic.getLatestPositionTime(mmsi);
			process.stdout.write('V');

			const vesselKml = await this.getVesselKml(lastMTUpdate);
			process.stdout.write('k');

			const placemarks = await this.parseKmlToPlacemarks(vesselKml);
			process.stdout.write(placemarks.length.toString());

			if (placemarks.length > 0) {
				const lastPlacemark = placemarks[placemarks.length - 1];
				process.stdout.write('@');
				await this.sendSelfReport(lastPlacemark);
				process.stdout.write('Δ');
			} else {
				process.stdout.write('×');
			}

			process.stdout.write('\n');
		} catch (error) {
			console.error(`[Error] ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get vessel route information since the last known entry as kml.
	 *
	 * @param {Date} lastEntry data after the date.
	 * @returns {*} The Vessel Kml data.
	 */
	async getVesselKml(lastEntry) {
		if (!process.env.MAPSHARE_ID) {
			throw new Error('MAPSHARE_ID environment variable is missing.');
		}

		return new InReachService()
			.getMapShareKML(process.env.MAPSHARE_ID, lastEntry);
	}

	/**
	 * Returns collection of placement objects from a KML.
	 *
	 * @param {*} kml data.
	 * @returns {Array} Array of Placemarks.
	 */
	async parseKmlToPlacemarks(kml) {
		/**
		 * Does placemark have ExtendedData data.
		 *
		 * @param {Placemark} placemark data.
		 * @returns {boolean} If placemark data is Non Extended.
		 */
		const nonExtendedData = placemark => {
			return (placemark.extendeddata);
		};

		/**
		 * Converts a placemark xml blob to a value object.
		 *
		 * @param {Placemark} placemark data.
		 * @returns {{id, visibility: string, imei, timeUTC: string, time: string, latitude, longitude, elevation, velocity, course, validGpsFix: string}} The Value Object (VO) for the target placemark.
		 */
		const placemarkXmlToVo = placemark => {
			const getProperty = (placemark, name) => {
				const data = placemark.extendeddata.data
					.filter(obj => {
						return (obj.name === name);
					})
					.pop();

				if (!data || !data.value) {
					throw new Error('Placemark does not have property: ' + name);
				}

				return data.value;
			};

			return {
				id: getProperty(placemark, 'Id'),
				imei: getProperty(placemark, 'IMEI'),
				timeUTC: getProperty(placemark, 'Time UTC'),
				time: getProperty(placemark, 'Time'),
				latitude: getProperty(placemark, 'Latitude'),
				longitude: getProperty(placemark, 'Longitude'),
				elevation: getProperty(placemark, 'Elevation'),
				velocity: getProperty(placemark, 'Velocity'),
				course: getProperty(placemark, 'Course'),
				validGpsFix: getProperty(placemark, 'Valid GPS Fix').toLowerCase(),
				visibility: placemark.visibility.toLowerCase()
			};
		};

		const blob = await new Promise((resolve, reject) => {
			new xml2js.Parser({
				mergeAttrs: true,
				explicitRoot: false,
				explicitArray: false,
				normalizeTags: true,
				preserveChildrenOrder: true
			}).parseString(kml, (err, data) => {
				if (err) {
					reject(err);
				}

				resolve(data);
			});
		});

		return (blob && blob.document && blob.document.folder && blob.document.folder.placemark) ? blob.document.folder.placemark
			.filter(nonExtendedData)
			.map(placemarkXmlToVo) : [];
	}

	async sendSelfReport(data) {
		if (!process.env.REPORT_SENDER) {
			throw new Error('REPORT_SENDER environment variable is missing.');
		}

		if (!process.env.REPORT_MMSI) {
			throw new Error('REPORT_MMSI environment variable is missing.');
		}

		const kmPerHrToKnots = kmPerHr => {
			return kmPerHr * 0.539957;
		};

		const pad = (n, width, z) => {
			z = z || '0';
			n = String(n);
			return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
		};

		process.stdout.write('>');
		const knots = kmPerHrToKnots(data.velocity.split(' ')[0]);
		const course = pad(data.course.split('.')[0], 3);
		// Moment does not need to have 'UTC' appended to input date
		const timestamp = moment(new Date(data.timeUTC)).format('YYYY-MM-DD HH:mm:ss');
		const body = '________________\n' +
			'MMSI=' + process.env.REPORT_MMSI + '\n' +
			'LAT=' + data.latitude + '\n' +
			'LON=' + data.longitude + '\n' +
			'SPEED=' + knots + '\n' +
			'COURSE=' + course + '\n' +
			'TIMESTAMP=' + timestamp + '\n' +
			'________________';
		const email = {
			to: process.env.REPORT_RECEIVER ? process.env.REPORT_RECEIVER : DEFAULT_REPORT_RECEIVER,
			from: process.env.REPORT_SENDER,
			subject: 'sAIS self-report',
			text: body
		};

		return new Promise(resolve => {
			sendgrid.send(email, (error, json) => {
				if (error) {
					console.error(error);
					throw error;
				}

				process.stdout.write('Λ');
				resolve(json);
			});
		});
	}

	getMMSI() {
		if (!process.env.REPORT_MMSI) {
			throw new Error('REPORT_MMSI environment variable is missing.');
		}

		return process.env.REPORT_MMSI;
	}
};
