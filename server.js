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

// Configure proxy trust for Render.com
app.set('trust proxy', true);

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rate limiting configuration with proper IPv6 handling
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    // Use the rate-limiter's built-in IP detection
    return rateLimit.ipKeyGenerator(req, res);
  }
});
// -------------------------- HELPER FUNCTIONS --------------------------

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

function createGeoJsonVolan(vehicles) {
    return {
        type: 'FeatureCollection',
        features: vehicles.map(vehicle => ({
            type: 'Feature',
            properties: {
                vehicleId: vehicle.vehicleId,
                label: vehicle.label,
                lat: vehicle.lat,
                lon: vehicle.lon,
                stopRelationshipStatus: vehicle.stopRelationship?.status || "",
                stopGtfsId: vehicle.stopRelationship?.stop?.gtfsId || "",
                stopName: vehicle.stopRelationship?.stop?.name || "",
                arrivalTime: vehicle.stopRelationship?.arrivalTime || "",
                departureTime: vehicle.stopRelationship?.departureTime || "",
                speed: vehicle.speed,
                heading: vehicle.heading,
                lastUpdated: vehicle.lastUpdated,
                tripId: vehicle.trip?.id || "",
                tripGtfsId: vehicle.trip?.gtfsId || "",
                routeShortName: vehicle.trip?.route?.shortName || "",
                routeMode: vehicle.trip?.route?.mode || "",
                routeLongName: vehicle.trip?.route?.longName || "",
                routeTextColor: vehicle.trip?.route?.textColor || "",
                routeColor: vehicle.trip?.route?.color || "",
                patternId: vehicle.trip?.pattern?.id || "",
                tripHeadsign: vehicle.trip?.tripHeadsign || "",
                tripShortName: vehicle.trip?.tripShortName || "",
                routeShortNameTrip: vehicle.trip?.routeShortName || "",
                directionId: vehicle.trip?.directionId || "",
                blockId: vehicle.trip?.blockId || "",
                shapeId: vehicle.trip?.shapeId || "",
                wheelchairAccessible: vehicle.trip?.wheelchairAccessible || "",
                bikesAllowed: vehicle.trip?.bikesAllowed || "",
                serviceId: vehicle.trip?.serviceId || "",
                activeDates: vehicle.trip?.activeDates || "",
                stopIds: vehicle.trip?.stops?.map(stop => stop.gtfsId).join(", ") || "",
                stopNames: vehicle.trip?.stops?.map(stop => stop.name).join(", ") || "",
                semanticHash: vehicle.trip?.semanticHash || "",
            },
            geometry: {
                type: 'Point',
                coordinates: [vehicle.lon, vehicle.lat],
            },
        })) || [],
    };
}

// -------------------------- ENDPOINTS --------------------------

// MAVSHAPE PROXY
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

// MAV PROXY
app.post('/fetch-mavrt', apiLimiter, async (req, res) => {
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 10000,
            validateStatus: () => true
        });

        if (response.status === 403) {
            try {
                const cachedData = fs.readFileSync('mav.geojson');
                return res.json({ 
                    mavGeoJson: JSON.parse(cachedData),
                    warning: "Using cached data due to API restriction"
                });
            } catch (cacheError) {
                return res.status(503).json({ 
                    error: 'Service unavailable',
                    details: 'API blocked the request and no cache available'
                });
            }
        }

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
            throw new Error('Vehicle positions not found in the response');
        }
    } catch (error) {
        console.error("Error fetching MAV data:", error.message);
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

// GYSEV PROXY
app.post('/fetch-gysevrt', apiLimiter, async (req, res) => {
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const data = response.data;

        if (data && data.data && data.data.vehiclePositions) {
            const gysevVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("1:") &&
                vehicle.trip.route.agency.name === "Győr-Sopron-Ebenfurti Vasút"
            );

            const gysevGeoJson = createGeoJsonMav(gysevVehicles);

            res.json({
                gysevGeoJson,
            });
        } else {
            throw new Error('Vehicle positions not found in the response');
        }
    } catch (error) {
        console.error("Error fetching GYSEV data:", error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// VOLAN PROXY
app.post('/fetch-volanrt', apiLimiter, async (req, res) => {
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const data = response.data;

        if (data && data.data && data.data.vehiclePositions) {
            const volanVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("hkir:")
            );

            const volanGeoJson = createGeoJsonVolan(volanVehicles);

            res.json({
                volanGeoJson,
            });
        } else {
            throw new Error('Vehicle positions not found in the response');
        }
    } catch (error) {
        console.error("Error fetching VOLAN data:", error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// TRAIN INFO
app.post('/fetch-info', apiLimiter, async (req, res) => {
    const { tripId, serviceDay } = req.body;

    if (!tripId) {
        return res.status(400).json({ error: 'Trip ID is required' });
    }

    const today = new Date();
    const defaultServiceDay = today.toISOString().split('T')[0];
    const finalServiceDay = serviceDay || defaultServiceDay;

    const query = `
        query {
            trip(id: "${tripId}", serviceDay: "${finalServiceDay}") {
                id
                gtfsId
                alerts(types: [ROUTE, TRIP]) {
                    alertHash
                    alertUrl
                    alertCause
                    alertEffect
                    alertHeaderText
                    alertSeverityLevel
                    alertDescriptionText
                    alertUrlTranslations { language text }
                    alertHeaderTextTranslations { language text }
                    alertDescriptionTextTranslations { text language }
                    id
                    effectiveStartDate
                    effectiveEndDate
                    feed
                }
                pattern { id }
                serviceDescriptions(language: "en-US")
                infoServices(language: "en-US", onlyDisplayable: true) {
                    name
                    fontCode
                    displayable
                    fontCharSet
                    fromStopIndex
                    tillStopIndex
                    fromStop { id: gtfsId name }
                    tillStop { id: gtfsId name }
                }
                route {
                    id
                    gtfsId
                    mode
                    alerts(types: [STOPS_ON_ROUTE]) {
                        alertHash
                        alertUrl
                        alertCause
                        alertEffect
                        alertHeaderText
                        alertSeverityLevel
                        alertDescriptionText
                        alertUrlTranslations { language text }
                        alertHeaderTextTranslations { language text }
                        alertDescriptionTextTranslations { text language }
                        id
                        effectiveStartDate
                        effectiveEndDate
                        feed
                    }
                    agency {
                        id: gtfsId
                        name
                        url
                        timezone
                        lang
                        phone
                        fareUrl
                    }
                    shortName
                    longName
                    type
                    url
                    color
                    textColor
                    routeBikesAllowed: bikesAllowed
                    bikesAllowed
                    patterns {
                        id
                        tripsForDate(serviceDate: "${finalServiceDay}") {
                            id: gtfsId
                            stops { id: gtfsId }
                        }
                    }
                }
                tripShortName
                tripHeadsign
                serviceId
                directionId
                blockId
                shapeId
                wheelchairAccessible
                bikesAllowed
                tripBikesAllowed: bikesAllowed
                stoptimes {
                    stop {
                        timezone
                    }
                    scheduledArrival
                    realtimeArrival
                    arrivalDelay
                    scheduledDeparture
                    realtimeDeparture
                    departureDelay
                    pickupType
                    dropoffType
                    timepoint
                    realtime
                    realtimeState
                    serviceDay
                    platformColor
                    stop {
                        alerts(types: [STOP_ON_ROUTES, STOP_ON_TRIPS, STOP]) {
                            alertHash
                            alertUrl
                            alertCause
                            alertEffect
                            alertHeaderText
                            alertSeverityLevel
                            alertDescriptionText
                            alertUrlTranslations { language text }
                            alertHeaderTextTranslations { language text }
                            alertDescriptionTextTranslations { text language }
                            id
                            effectiveStartDate
                            effectiveEndDate
                            feed
                        }
                        id: gtfsId
                        stopId: gtfsId
                        platformCode
                        code
                        name
                        lat
                        lon
                        geometries { geoJson }
                    }
                }
                tripGeometry { length points }
                isThroughCoach
                throughCoaches {
                    trip {
                        id: gtfsId
                        tripShortName
                        routeShortName
                        stoptimes { stop { name } }
                        route { mode shortName longName textColor color }
                    }
                    attachedFromStop { name }
                    attachedTillStop { name }
                    serviceDateDayChange
                }
                pullingTrips {
                    trip {
                        id: gtfsId
                        tripShortName
                        routeShortName
                        stoptimes { stop { name } }
                        route { mode shortName longName textColor color }
                    }
                    attachedFromStop { name }
                    attachedTillStop { name }
                    serviceDateDayChange
                }
                vehiclePositions {
                    stopRelationship {
                        status
                        stop { id gtfsId name }
                        arrivalTime
                        departureTime
                    }
                    vehicleId
                    lat
                    lon
                    label
                    speed
                    heading
                    lastUpdated
                    trip { tripShortName gtfsId }
                }
            }
        }
    `;

    try {
        const response = await axios.post(
            'https://emma.mav.hu/otp2-backend/otp/routers/default/index/graphql',
            { query },
            {
                headers: { 
                    'Content-Type': 'application/json',
                    'Referer': 'https://emma.mav.hu/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 10000
            }
        );

        const data = response.data;

        if (!data || !data.data || !data.data.trip) {
            return res.status(404).json({ error: 'Trip data not found' });
        }

        res.json(data.data.trip);
    } catch (error) {
        console.error('Error fetching trip info:', error.message);
        res.status(500).json({ error: 'Failed to fetch trip data' });
    }
});

// HEALTH CHECK
app.get('/eletjel', cors(), async (req, res) => {
    try {
        res.status(200).json({ 
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check server status' });
    }
});

// STATIC SERVER
app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(`Request for: ${req.url} from IP: ${clientIp}`);
    next();
});

app.use(express.static(path.join(__dirname, 'static')));

app.get('/', (req, res) => {
    res.send('Server is running. Available endpoints: /fetch-mavrt, /fetch-gysevrt, /fetch-volanrt, /fetch-info, /fetch-shape, /eletjel');
});

// START SERVER
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${port}`);
}).on('error', (err) => {
    console.error('Server failed to start:', err);
});

