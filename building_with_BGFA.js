// Load the datasets
var buildings = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons');
var temporal = ee.ImageCollection('GOOGLE/Research/open-buildings-temporal/v1');

// Define Pune region
var puneCoords = {
  minLon: 73.8500,
  minLat: 18.5200,
  maxLon: 73.8600,
  maxLat: 18.5300
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

// Function to calculate BGFA
function calculateBGFA(height, area) {
  // Handle null height values
  return ee.Algorithms.If(ee.Algorithms.IsEqual(height, null),
    ee.Number(area),  // If height is null, return just the area (1 floor)
    ee.Number(area).multiply(  // Otherwise calculate BGFA normally
      ee.Number(height).divide(3).ceil()
    )
  );
}

// Function to get heights, area, and BGFA for all years at a point
function getHeightsAndArea(feature) {
  var centroid = feature.geometry().centroid();
  
  // Calculate area in square meters
  var area = feature.geometry().area();
  
  // Get heights and calculate BGFA for each year
  var yearData = years.map(function(year) {
    var heightImage = ee.Image(heightImages.get(String(year)));
    var heightVal = heightImage.reduceRegion({
      reducer: ee.Reducer.first(),
      geometry: centroid,
      scale: 10
    }).get('building_height');
    
    // Create property names for this year's height and BGFA
    var heightProp = 'height_' + year;
    var bgfaProp = 'bgfa_' + year;
    
    // Calculate BGFA for this year
    var bgfaVal = calculateBGFA(heightVal, area);
    
    return [heightProp, heightVal, bgfaProp, bgfaVal];
  });
  
  // Convert year data to a dictionary
  var dataDict = ee.Dictionary(ee.List(yearData).flatten());
  
  // Add base properties including area
  var baseProps = {
    'longitude': centroid.coordinates().get(0),
    'latitude': centroid.coordinates().get(1),
    'confidence': feature.get('confidence'),
    'area_m2': area
  };
  
  return ee.Feature(centroid, dataDict.combine(baseProps));
}

// Filter buildings first
var filteredBuildings = buildings
  .filterBounds(puneRegion)
  .filter(ee.Filter.gte('confidence', 0.7));

// Process buildings to get heights, area, and BGFA
var processedBuildings = filteredBuildings.map(getHeightsAndArea);

// Ensure at least one height value exists across all years
var validationFilters = years.map(function(year) {
  return ee.Filter.notNull(['height_' + year]);
});

var validBuildings = processedBuildings.filter(
  ee.Filter.or.apply(null, validationFilters)
);

// Update export to include BGFA values
Export.table.toDrive({
  collection: validBuildings,
  description: 'pune_buildings_temporal_heights_area_bgfa',
  fileFormat: 'CSV',
  folder: 'Pune_Building_Analysis',
  selectors: ['longitude', 'latitude', 'confidence', 'area_m2']
    .concat(years.reduce(function(acc, year) { 
      return acc.concat(['height_' + year, 'bgfa_' + year]); 
    }, []))
});

// Add BGFA statistics to the output
years.forEach(function(year) {
  var heightProp = 'height_' + year;
  var bgfaProp = 'bgfa_' + year;
  var nonNullBuildings = validBuildings.filter(ee.Filter.notNull([heightProp]));
  
  print('Year ' + year + ':');
  print('  Buildings with height data:', nonNullBuildings.size());
  print('  Height statistics:', nonNullBuildings.aggregate_stats(heightProp));
  print('  BGFA statistics:', nonNullBuildings.aggregate_stats(bgfaProp));
});

// Add BGFA distribution charts
years.forEach(function(year, index) {
  var bgfaChart = ui.Chart.feature.histogram({
    features: validBuildings.filter(ee.Filter.notNull(['bgfa_' + year])),
    property: 'bgfa_' + year,
    maxBuckets: 20,
    minBucketWidth: 10
  }).setOptions({
    title: 'Building BGFA Distribution - ' + year,

    hAxis: {title: 'BGFA (m²)'},
    vAxis: {title: 'Count'}
  });
  print('BGFA Distribution ' + year + ':', bgfaChart);
});
