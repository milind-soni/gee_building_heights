// Load the datasets
var buildings = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons');
var temporal = ee.ImageCollection('GOOGLE/Research/open-buildings-temporal/v1');

// Define Pune region
var puneCoords = {
  minLon: 73.7500,
  minLat: 18.4500,
  maxLon: 73.9500,
  maxLat: 18.6500
};

// Create main region geometry
var puneRegion = ee.Geometry.Rectangle([
  puneCoords.minLon, puneCoords.minLat,
  puneCoords.maxLon, puneCoords.maxLat
]);

// Get height data for 2023
var date2023 = ee.Date('2023-06-30', 'America/Los_Angeles');
var epoch2023 = date2023.millis().divide(1000);
var heightImage = temporal
  .filter(ee.Filter.eq('inference_time_epoch_s', epoch2023))
  .filterBounds(puneRegion)
  .mosaic()
  .clip(puneRegion)
  .select('building_height');

// Function to simplify building data to just centroid and height
var simplifyBuilding = function(feature) {
  var centroid = feature.geometry().centroid();
  
  // Get height at centroid point
  var heightVal = heightImage.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: centroid,
    scale: 10
  }).get('building_height');
  
  return ee.Feature(centroid, {
    'longitude': centroid.coordinates().get(0),
    'latitude': centroid.coordinates().get(1),
    'height': heightVal,
    'confidence': feature.get('confidence')
  });
};

// Filter buildings first
var filteredBuildings = buildings
  .filterBounds(puneRegion)
  .filter(ee.Filter.gte('confidence', 0.7));

// Process buildings
var processedBuildings = filteredBuildings.map(simplifyBuilding);

// Remove any null height values
var validBuildings = processedBuildings.filter(ee.Filter.notNull(['height']));

// Visualization
Map.setCenter(73.8567, 18.5204, 12);
Map.setOptions('SATELLITE');

// Add height visualization layer
Map.addLayer(heightImage, {
  min: 0,
  max: 100,
  palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red']
}, 'Building Heights');

// Add point visualization
Map.addLayer(validBuildings, {
  color: 'red'
}, 'Building Centroids');

// Export simplified data
Export.table.toDrive({
  collection: validBuildings,
  description: 'pune_buildings_centroids_heights',
  fileFormat: 'CSV',
  folder: 'Pune_Building_Analysis',
  selectors: ['longitude', 'latitude', 'height', 'confidence']
});

// Calculate basic statistics
var stats = validBuildings.aggregate_stats('height');

print('Basic Statistics:');
print('Total Buildings:', validBuildings.size());
print('Height Statistics:', stats);

// Create height distribution chart
var heightChart = ui.Chart.feature.histogram({
  features: validBuildings,
  property: 'height',
  maxBuckets: 50,
  minBucketWidth: 1
}).setOptions({
  title: 'Building Height Distribution in Pune',
  hAxis: {title: 'Height (m)'},
  vAxis: {title: 'Count'}
});
print(heightChart);

// Height categories analysis
var heightCategories = ee.List([10, 20, 30, 40, 50]);
heightCategories.evaluate(function(heights) {
  heights.forEach(function(height) {
    var buildingsAbove = validBuildings.filter(ee.Filter.gt('height', height));
    print('Buildings taller than ' + height + 'm:', buildingsAbove.size());
  });
});

// Print sample of the data to verify structure
print('Sample building data:', validBuildings.limit(5));
