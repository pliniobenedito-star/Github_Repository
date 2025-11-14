import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./App.css";

mapboxgl.accessToken = "pk.eyJ1IjoicGxpbmlvLXBpY2NpbiIsImEiOiJjbWh0NWFwN20xOWIyMmtyNHJ1M3AyZXJzIn0.nv6q66EUGokaNIM92SK-1g";

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const pathCoords = useRef([]);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("Click the button to start tracking your location.");

  // Initialize map
  useEffect(() => {
    if (map.current) return; // initialize map only once
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/plinio-piccin/cmhw00fii000m01qwcuwq9yje",
      center: [-0.1276, 51.5072],
      zoom: 13,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
  }, []);

  // Geolocation effect
  useEffect(() => {
    if (!tracking) {
      return;
    }

    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.");
      setTracking(false);
      return;
    }

    setStatus("Requesting location permission... Please check your browser for a permission prompt.");
    console.log("Requesting location permission...");

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setStatus("Location found. Updating map.");
        console.log("Position update received:", position);
        const { latitude, longitude } = position.coords;
        const coords = [longitude, latitude];

        if (!marker.current) {
          marker.current = new mapboxgl.Marker({ color: "red" }).setLngLat(coords).addTo(map.current);
        } else {
          marker.current.setLngLat(coords);
        }

        map.current.flyTo({ center: coords, speed: 0.8 });

        pathCoords.current.push(coords);
        if (pathCoords.current.length > 1) {
          const geojson = {
            type: "Feature",
            geometry: { type: "LineString", coordinates: pathCoords.current },
          };

          if (map.current.getSource("path")) {
            map.current.getSource("path").setData(geojson);
          } else {
            map.current.addSource("path", { type: "geojson", data: geojson });
            map.current.addLayer({
              id: "path",
              type: "line",
              source: "path",
              paint: { "line-color": "#007aff", "line-width": 4 },
            });
          }
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        let errorMessage = `ERROR: ${error.message}`;
        if (error.code === 1) {
          errorMessage = "Permission denied. Please enable location services in your browser settings.";
        }
        setStatus(errorMessage);
        setTracking(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );

    return () => {
      console.log("Stopping location tracking.");
      navigator.geolocation.clearWatch(watchId);
    };
  }, [tracking]);

  const handleStartTracking = () => {
    setTracking(true);
  };

  const handleStopTracking = () => {
    setTracking(false);
    setStatus("Tracking stopped. Click the button to start again.");
  };

  const handleJumpToLocation = () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.");
      return;
    }
    setStatus("Finding your current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        map.current.flyTo({ center: [longitude, latitude], zoom: 15, speed: 0.8 });
        setStatus("Jumped to your current location.");
      },
      (error) => {
        console.error("Geolocation error:", error);
        setStatus(`Error finding location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  return (
    <div>
      <div ref={mapContainer} className="map-container" />
      <div className="sidebar">
        <p>{status}</p>
        {!tracking ? (
          <button onClick={handleStartTracking}>Start Tracking</button>
        ) : (
          <button onClick={handleStopTracking}>Stop Tracking</button>
        )}
        <p style={{fontSize: "0.8em", marginTop: "1em"}}>
          If you don't see a location permission prompt, please check your browser's console for errors. You can open the console by pressing F12 or Ctrl+Shift+I.
        </p>
      </div>
    </div>
  );
}

export default App;