/* eslint-disable quotes */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const csvParser = require('csv-parser');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 25555; 

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rate limiting for MAV endpoints
const mavLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

// -------------------------- MAVSHAPE PROXY --------------------------

function decodePolyline(encoded) {
    let len = encoded.length;
    let index = 0;
    let lat = 0;
    let lng = 0;
    let coordinates = [];

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        coordinates.push([lng / 1E5, lat / 1E5]);
    }

    return coordinates;
}

function createGeoJson(polylinePoints) {
    const coordinates = decodePolyline(polylinePoints);

    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates,
                },
                properties: {
                    tripId: '1:20238633',
                    date: '20241208',
                }
            }
        ]
    };
}

app.get('/fetch-shape', async (req, res) => {
    const tripId = req.query.tripId;
    if (!tripId) {
        return res.status(400).json({ error: 'Trip ID is required' });
    }

    const url = `https://emma.mav.hu/otp2-backend/otp/routers/default/index/trips/${tripId}/geometry`;

    try {
        const response = await fetch(url, {
            headers: {
                'Referer': 'https://emma.mav.hu/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch data from the API');
        }

        const data = await response.json();

        if (data && data.points) {
            const geoJson = createGeoJson(data.points);
            res.json(geoJson);
        } else {
            throw new Error('Polyline points not found in the response');
        }
    } catch (error) {
        console.error("Error fetching data:", error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// -------------------------- MAV PROXY --------------------------

function createGeoJsonMav(vehicles) {
    return {
        type: 'FeatureCollection',
        features: vehicles.map(vehicle => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [vehicle.lon, vehicle.lat],
            },
            properties: {
                vehicleId: vehicle.vehicleId,
                label: vehicle.label,
                lat: vehicle.lat,
                lon: vehicle.lon,
                speed: vehicle.speed,
                heading: vehicle.heading,
                lastUpdated: vehicle.lastUpdated,

                stopRelationship: {
                    status: vehicle.stopRelationship?.status || "",
                    stop: {
                        gtfsId: vehicle.stopRelationship?.stop?.gtfsId || "",
                        name: vehicle.stopRelationship?.stop?.name || ""
                    },
                    arrivalTime: vehicle.stopRelationship?.arrivalTime || "",
                    departureTime: vehicle.stopRelationship?.departureTime || ""
                },

                trip: {
                    id: vehicle.trip?.id || "",
                    gtfsId: vehicle.trip?.gtfsId || "",
                    routeShortName: vehicle.trip?.routeShortName || "",

                    route: {
                        shortName: vehicle.trip?.route?.shortName || "",
                        mode: vehicle.trip?.route?.mode || "",
                        longName: vehicle.trip?.route?.longName || "",
                        textColor: vehicle.trip?.route?.textColor || "",
                        color: vehicle.trip?.route?.color || "",
                        agency: {
                            name: vehicle.trip?.route?.agency?.name || ""
                        }
                    },

                    pattern: {
                        id: vehicle.trip?.pattern?.id || ""
                    },

                    tripHeadsign: vehicle.trip?.tripHeadsign || "",
                    tripShortName: vehicle.trip?.tripShortName || "",

                    directionId: vehicle.trip?.directionId || "",
                    blockId: vehicle.trip?.blockId || "",
                    shapeId: vehicle.trip?.shapeId || "",
                    wheelchairAccessible: vehicle.trip?.wheelchairAccessible || "",
                    bikesAllowed: vehicle.trip?.bikesAllowed || "",
                    serviceId: vehicle.trip?.serviceId || "",
                    semanticHash: vehicle.trip?.semanticHash || "",
                    activeDates: vehicle.trip?.activeDates || [],

                    arrivalStoptime: {
                        arrivalDelay: vehicle.trip?.arrivalStoptime?.arrivalDelay || "",
                        stop: {
                            name: vehicle.trip?.arrivalStoptime?.stop?.name || ""
                        }
                    },

                    stops: vehicle.trip?.stops?.map(stop => ({
                        gtfsId: stop.gtfsId,
                        name: stop.name
                    })) || []
                }
            }
        })) || [],
    };
}

app.post('/fetch-mavrt', mavLimiter, async (req, res) => {
    const url = 'https://emma.mav.hu/otp2-backend/otp/routers/default/index/graphql';

    const query = `{
        vehiclePositions(swLat: 45.7, swLon: 16.0, neLat: 48.5, neLon: 22.5) {
            vehicleId
            label
            lat
            lon
            stopRelationship {
                status
                stop {
                    gtfsId
                    name
                }
                arrivalTime
                departureTime
            }
            speed
            heading
            lastUpdated
            trip {
                id
                gtfsId
                route {
                    shortName
                    mode
                    longName
                    textColor
                    color
                    agency{
                        name
                    }
                }
                pattern {
                    id
                }
                tripHeadsign
                tripShortName
                routeShortName
                directionId
                blockId
                shapeId
                wheelchairAccessible
                bikesAllowed
                serviceId
                activeDates
                arrivalStoptime {
                    arrivalDelay
                    stop {
                        name
                    }
                }
                stops {
                    gtfsId
                    name
                }
                semanticHash
            }
        }
    }`;

    try {
        const response = await axios.post(url, { query }, {
            headers: { 
                'Content-Type': 'application/json',
                'Referer': 'https://emma.mav.hu/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'X-Forwarded-For': req.headers['x-forwarded-for'] || req.ip
            },
            timeout: 10000
        });

        const data = response.data;

        if (data && data.data && data.data.vehiclePositions) {
            const mavVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("1:") &&
                vehicle.trip.route.agency.name !== "Győr-Sopron-Ebenfurti Vasút"
            );

            const mavGeoJson = createGeoJsonMav(mavVehicles);

            fs.writeFileSync('mav.geojson', JSON.stringify(mavGeoJson, null, 2));

            res.json({
                mavGeoJson,
            });
        } else {
            console.error("Vehicle positions not found in the response");
            res.status(500).json({ error: 'Vehicle positions not found' });
        }

    } catch (error) {
        console.error("Error fetching MAV data:", error.message);
        
        // Fallback to cached data if available
        try {
            const cachedData = fs.readFileSync('mav.geojson');
            res.json({ 
                mavGeoJson: JSON.parse(cachedData),
                warning: "Using cached data due to API error"
            });
        } catch (cacheError) {
            res.status(500).json({ 
                error: 'Failed to fetch data',
                details: error.message
            });
        }
    }
});

// [Rest of your original endpoints remain exactly the same...]
// /fetch-gysevrt
// /fetch-volanrt
// /fetch-info
// /eletjel
// Static server and other configurations

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${port}`);
});
