// Load the datasets
var buildings = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons');
var temporal = ee.ImageCollection('GOOGLE/Research/open-buildings-temporal/v1');

// Define Pune region
var puneCoords = {
  minLon: 73.8500,  // Reduced area
  minLat: 18.5200,  // Reduced area
  maxLon: 73.8600,  // Reduced area
  maxLat: 18.5300   // Reduced area
};

// Create main region geometry
var puneRegion = ee.Geometry.Rectangle([
  puneCoords.minLon, puneCoords.minLat,
  puneCoords.maxLon, puneCoords.maxLat
]);

// Define years to process
var years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];

// Function to get height image for a specific year
function getHeightImageForYear(year) {
  var date = ee.Date(year + '-06-30', 'America/Los_Angeles');
  var epoch = date.millis().divide(1000);
  return temporal
    .filter(ee.Filter.eq('inference_time_epoch_s', epoch))
    .filterBounds(puneRegion)
    .mosaic()
    .clip(puneRegion)
    .select('building_height');
}

// Create a dictionary of height images for all years
var heightImages = ee.Dictionary.fromLists(
  years.map(String),
  years.map(function(year) {
    return getHeightImageForYear(year);
  })
);

// Function to get heights for all years at a point
function getHeightsForAllYears(feature) {
  var centroid = feature.geometry().centroid();
  
  // Get heights for each year
  var yearHeights = years.map(function(year) {
    var heightImage = ee.Image(heightImages.get(String(year)));
    var heightVal = heightImage.reduceRegion({
      reducer: ee.Reducer.first(),
      geometry: centroid,
      scale: 10
    }).get('building_height');
    
    // Create property name for this year's height
    var heightProp = 'height_' + year;
    return [heightProp, heightVal];
  });
  
  // Convert year heights to a dictionary
  var heightsDict = ee.Dictionary(ee.List(yearHeights).flatten());
  
  // Add base properties
  var baseProps = {
    'longitude': centroid.coordinates().get(0),
    'latitude': centroid.coordinates().get(1),
    'confidence': feature.get('confidence')
  };
  
  return ee.Feature(centroid, heightsDict.combine(baseProps));
}

// Filter buildings first
var filteredBuildings = buildings
  .filterBounds(puneRegion)
  .filter(ee.Filter.gte('confidence', 0.7));

// Process buildings to get heights for all years
var processedBuildings = filteredBuildings.map(getHeightsForAllYears);

// Ensure at least one height value exists across all years
var validationFilters = years.map(function(year) {
  return ee.Filter.notNull(['height_' + year]);
});

var validBuildings = processedBuildings.filter(
  ee.Filter.or.apply(null, validationFilters)
);

// Visualization setup
Map.setCenter(73.8567, 18.5204, 12);
Map.setOptions('SATELLITE');

// Add visualization layers for each year
years.forEach(function(year) {
  var heightImage = ee.Image(heightImages.get(String(year)));
  Map.addLayer(heightImage, {
    min: 0,
    max: 100,
    palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red']
  }, 'Building Heights ' + year, false);  // Set to false to not show all layers at once
});

// Export temporal data
Export.table.toDrive({
  collection: validBuildings,
  description: 'pune_buildings_temporal_heights',
  fileFormat: 'CSV',
  folder: 'Pune_Building_Analysis',
  selectors: ['longitude', 'latitude', 'confidence']
    .concat(years.map(function(year) { return 'height_' + year; }))
});

// Print total number of buildings
print('Total valid buildings:', validBuildings.size());

// Calculate and print basic statistics for each year
years.forEach(function(year) {
  var propName = 'height_' + year;
  var nonNullBuildings = validBuildings.filter(ee.Filter.notNull([propName]));
  
  print('Year ' + year + ':');
  print('  Buildings with height data:', nonNullBuildings.size());
  print('  Height statistics:', nonNullBuildings.aggregate_stats(propName));
});

// Create a single chart showing height distributions for all years
var yearColors = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf'];
var histogramData = years.map(function(year, index) {
  return ui.Chart.feature.histogram({
    features: validBuildings.filter(ee.Filter.notNull(['height_' + year])),
    property: 'height_' + year,
    maxBuckets: 30,
    minBucketWidth: 1
  })
  .setOptions({
    title: 'Building Height Distributions by Year',
    colors: [yearColors[index]],
    hAxis: {title: 'Height (m)', viewWindow: {min: 0, max: 100}},
    vAxis: {title: 'Count'},
    legend: {position: 'right'}
  });
});

histogramData.forEach(function(chart, index) {
  print('Height Distribution ' + years[index], chart);
});

// Print sample of the temporal data
print('Sample building data:', validBuildings.limit(5));
