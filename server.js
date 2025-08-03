/* eslint-disable quotes */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const csvParser = require('csv-parser');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 25555;

app.use(cors());
app.use(express.json());



function logError(context, error, extra = {}) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] (X) Error in ${context}`);
    console.error(`Message: ${error.message}`);
    if (error.stack) console.error(`Stack: ${error.stack}`);
    if (extra.url) console.error(`Request URL: ${extra.url}`);
    if (extra.status) console.error(`Status Code: ${extra.status}`);
    if (extra.body) console.error(`Response Body: ${JSON.stringify(extra.body, null, 2)}`);
    console.error('---');
}




// -------------------------- MAVSHAPE PROXY --------------------------

// Function to decode polyline string into coordinates (lat, lon)
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

        coordinates.push([lng / 1E5, lat / 1E5]); // Divide by 1E5 to get coordinates in decimal degrees
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
                    tripId: '1:20238633', // This will be dynamic based on the request
                    date: '20241208',
                }
            }
        ]
    };
}

app.get('/fetch-shape', async (req, res) => {
    const tripId = req.query.tripId; // Read the tripId from the query string
    if (!tripId) {
        return res.status(400).json({ error: 'Trip ID is required' });
    }

    const url = `https://emma.mav.hu//otp2-backend/otp/routers/default/index/trips/${tripId}/geometry`;

    try {
        // Fetch polyline data
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://emma.mav.hu/',
                'Origin': 'https://emma.mav.hu'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch data from the API');
        }

        const data = await response.json();

        // Check if the data contains polyline points
        if (data && data.points) {
            // Create GeoJSON from polyline points
            const geoJson = createGeoJson(data.points);



            // Return the GeoJSON response
            res.json(geoJson);
        } else {
            throw new Error('Polyline points not found in the response');
        }
    } catch (error) {
        let body = null;
        try {
            const errRes = await fetch(url);
            body = await errRes.text();
        } catch (_) { }

        logError("fetch-shape", error, {
            url,
            body
        });

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

app.all('/fetch-mavrt', async (req, res) => {
    const url = 'https://emma.mav.hu//otp2-backend/otp/routers/default/index/graphql';

    // Fix GraphQL query
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
            headers: { 'Content-Type': 'application/json' },
        });

        const data = response.data;

        if (data) {
            console.log('GraphQL Responded (MAV)');
        }


        // Ensure that data.data and data.data.vehiclePositions are defined before mapping
        if (data && data.data && data.data.vehiclePositions) {

            const mavVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("1:") &&
                vehicle.trip.route.agency.name !== "Győr-Sopron-Ebenfurti Vasút"
            );

            // Create GeoJSON for the filtered vehicles
            const mavGeoJson = createGeoJsonMav(mavVehicles);

            fs.writeFileSync('mav.geojson', JSON.stringify(mavGeoJson, null, 2));
            console.log('GeoJSON saved to mav.geojson'); // Add this log

            // Respond with the GeoJSON data for the selected vehicles
            res.json({
                mavGeoJson,
            });
        } else {
            // If the data is missing or vehiclePositions is undefined, handle the error
            console.error("Vehicle positions not found in the response");
            console.log(data)
            res.status(500).json({ error: 'Vehicle positions not found' });
        }

    } catch (error) {
        const status = error.response?.status;
        const body = error.response?.data;

        logError("fetch-mavrt", error, {
            url,
            status,
            body
        });

        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.all('/fetch-gysevrt', async (req, res) => {
    const url = 'https://emma.mav.hu//otp2-backend/otp/routers/default/index/graphql';


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
            headers: { 'Content-Type': 'application/json' },
        });

        const data = response.data;

        if (data) {
            console.log('GraphQL Responded (GYSEV)');
        }

        if (data && data.data && data.data.vehiclePositions) {
            const gysevVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("1:") &&
                vehicle.trip.route.agency.name === "Győr-Sopron-Ebenfurti Vasút"
            );

            const gysevGeoJson = createGeoJsonMav(gysevVehicles);

            /*
            fs.writeFileSync('gysev.geojson', JSON.stringify(gysevGeoJson, null, 2));
            console.log('GeoJSON saved to gysev.geojson');
            */

            res.json({
                gysevGeoJson,
            });
        } else {
            console.error("Vehicle positions not found in the response");
            res.status(500).json({ error: 'Vehicle positions not found' });
        }

    } catch (error) {
        console.error("Error fetching data:", error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// -------------------------- VOLAN NEW PROXY --------------------------


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

app.all('/fetch-volanrt', async (req, res) => {
    const url = 'https://emma.mav.hu//otp2-backend/otp/routers/default/index/graphql';

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
            headers: { 'Content-Type': 'application/json' },
        });

        const data = response.data;

        if (data) {
            console.log('GraphQL Responded (VOLAN)');
        }


        if (data && data.data && data.data.vehiclePositions) {
            const volanVehicles = data.data.vehiclePositions.filter(vehicle =>
                vehicle.vehicleId && vehicle.vehicleId.startsWith("hkir:")//CHANGED FROM kti:
            );


            const volanGeoJson = createGeoJsonVolan(volanVehicles);

            /*
            fs.writeFileSync('volanbusz.geojson', JSON.stringify(volanGeoJson, null, 2));
            console.log('GeoJSON saved to volanbusz.geojson');
            */


            res.json({
                volanGeoJson,
            });
        } else {

            console.error("Vehicle positions not found in the response");
            res.status(500).json({ error: 'Vehicle positions not found' });
        }

    } catch (error) {
        console.error("Error fetching data:", error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.get('/eletjel', cors(), async (req, res) => {
    try {
        res.status(200).json({ message: 'Server is running' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check server status' });
    }
});


// app.get('/m1', cors(), async (req, res) => {
//     try {
//         res.json({
//             "type": "FeatureCollection",  "features": [    {      "type": "Feature",      "properties": {        "shape_id": "1109"      },    
//     } catch (error) {
//         res.status(500).json({ error: 'Failed to return m1' });
//     }


// });

// -------------------------- GET TRAIN INFO --------------------------

app.post('/fetch-info', async (req, res) => {
    const { tripId, serviceDay } = req.body;

    if (!tripId) {
        return res.status(400).json({ error: 'Trip ID is required' });
    }

    const today = new Date();
    const defaultServiceDay = today.toISOString().split('T')[0]; // format: YYYY-MM-DD
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
            'https://emma.mav.hu//otp2-backend/otp/routers/default/index/graphql',
            { query },
            {
                headers: { 'Content-Type': 'application/json' },
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


// -------------------------- STATIC SERVER --------------------------

// Middleware to log IP addresses of connected devices
app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Request for: ${req.url}`);
    console.log(`New connection from IP: ${clientIp}`);
    next();
});

// Middleware to log the requested file paths
app.use((req, res, next) => {
    console.log('Requested Path:', req.path); // Logs the requested path
    next();
});

// Serve the 'static' folder directly as static files (publicly accessible at the root)
app.use(express.static(path.join(__dirname, 'static')));

// Optionally, serve an HTML file for testing purposes
app.get('/', async (req, res) => {
    const endpoints = [
        { path: '/fetch-shape', method: 'GET', description: 'Fetches polyline shape for a given trip ID.', args: 'tripId=<GTFS_trip_id>' },
        { path: '/fetch-mavrt', method: 'GET, POST', description: 'Fetches real-time MÁV vehicle positions.', args: '' },
        { path: '/fetch-gysevrt', method: 'GET, POST', description: 'Fetches real-time GYSEV vehicle positions.', args: '' },
        { path: '/fetch-volanrt', method: 'GET, POST', description: 'Fetches real-time Volánbusz vehicle positions.', args: '' },
        { path: '/fetch-info', method: 'POST', description: 'Fetches detailed trip information.', args: 'body: { tripId: string, serviceDay?: YYYY-MM-DD }' },
        { path: '/eletjel', method: 'GET', description: 'Checks if the server is running.', args: '' },
    ];

    let statusChecks = [];
    for (const endpoint of endpoints) {
        let status = 'N/A';
        let statusCode = 'N/A';
        let statusText = 'N/A';
        let responseTime = 'N/A';
        let error = null;

        // Only check GET endpoints for live status on the dashboard for simplicity
        if (endpoint.method.includes('GET')) {
            const startTime = process.hrtime.bigint();
            try {
                const testUrl = `http://localhost:${port}${endpoint.path}`;
                const fetchOptions = {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                };
                // Add a dummy tripId for /fetch-shape to make it a valid request
                const finalTestUrl = endpoint.path === '/fetch-shape' ? `${testUrl}?tripId=1:20238633` : testUrl;

                const response = await fetch(finalTestUrl, fetchOptions);
                const endTime = process.hrtime.bigint();
                responseTime = `${Number(endTime - startTime) / 1_000_000} ms`;
                statusCode = response.status;
                statusText = response.statusText;

                if (response.ok) {
                    status = '🟢 OK';
                } else {
                    // Attempt to read response body for more detailed error
                    // This might consume the stream, so do it carefully
                    status = `🔴 Error (${response.status})`;
                    error = await response.text();
                }
            } catch (err) {
                const endTime = process.hrtime.bigint();
                responseTime = `${Number(endTime - startTime) / 1_000_000} ms`;
                status = '🔴 Failed to connect';
                error = err.message;
            }
        } // End of if (endpoint.method.includes('GET'))
        statusChecks.push({ ...endpoint, status, statusCode, statusText, responseTime, error });
    }

    const dashboardHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Server Dashboard</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background-color: #f4f4f4; color: #333; }
                .container { background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #0056b3; }
                .info-box { background-color: #e9f5ff; border: 1px solid #b3d9ff; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #0056b3; color: white; }
                .status-ok { color: green; font-weight: bold; }
                .status-error { color: red; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Server Dashboard</h1>
                <div class="info-box">
                    <p><strong>Server IP:</strong> ${req.ip || 'N/A'}</p>
                    <p><strong>Server Port:</strong> ${port}</p>
                    <p>Welcome to the local server! You can access static files at the root.</p>
                </div>
                <h2>Endpoints</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Method</th>
                            <th>Description</th>
                            <th>Arguments</th>
                            <th>Live Status</th>
                            <th>Status Code</th>
                            <th>Response Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${statusChecks.map(ep => `
                            <tr>
                                <td>${ep.path}</td>
                                <td>${ep.path}</td>
                                <td>${ep.method}</td>
                                <td>${ep.description}</td>
                                <td><code>${ep.args}</code></td>
                                <td class="${ep.status.includes('OK') ? 'status-ok' : 'status-error'}">${ep.status} ${ep.status.includes('OK') ? '' : ep.statusText}</td>
                                <td>${ep.responseTime}</td>
                            </tr>
                            
                        `).join('')}
                    </tbody>
                </table>
                <p>Note: POST endpoints and <code>/fetch-shape</code> require specific arguments and are not fully tested for live status here.</p>
            </div>
        </body>
        </html>
    `;

    res.send(dashboardHtml);
});



app.listen(port, () => {
    console.log(`\nMerged server is running on http://localhost:${port}\n`);
    console.log(`----------------------------------------------------------------------`);
    console.log(`Available Endpoints:`);
    console.log(`GET   /fetch-shape?tripId=<GTFS_trip_id>`);
    console.log(`GET, POST  /fetch-mavrt`);
    console.log(`GET, POST  /fetch-gysevrt`);
    console.log(`GET, POST  /fetch-volanrt`);
    console.log(`POST  /fetch-info    body: { tripId: string, serviceDay?: YYYY-MM-DD }`);
    console.log(`GET   /eletjel`);
    console.log(`GET   /             Static HTML root`);
    console.log(`----------------------------------------------------------------------`);
    console.log('');
});
