// Constants for years
var YEARS = [];
for (var i = 2016; i < 2024; i++) {
  YEARS.push(i);
}

// Color palettes
var PRESENCE_PALETTE = [
  '#440154', '#433982', '#30678D', '#218F8B', '#36B677', '#8ED542', '#FDE725'
];
// Added missing '#' for each color in the height palette.
var HEIGHT_PALETTE = ['#1d4877', '#1b8a5a', '#fbb021', '#f68838', '#ee3e32'];

// Analysis constants
var FLOOR_HEIGHT = 3; // meters per floor

// (Optional) Multiplier for building height if the dataset values are not in meters.
// For example, if values are in decimeters, set this to 10.
var HEIGHT_MULTIPLIER = 1; // Change to 10 if needed

// Load the dataset
var imageCollection = ee.ImageCollection('GOOGLE/Research/open-buildings-temporal/v1');

// Create annual mosaics
var annualMosaics = ee.List(YEARS).map(function(year) {
  var dateStr = ee.String(year).cat('-06-30');
  var epoch_s = ee.Date(dateStr, 'America/Los_Angeles').millis().divide(1000);
  return imageCollection.filter(ee.Filter.eq('inference_time_epoch_s', epoch_s))
      .mosaic()
      .set('year', year);  // Add year as property for reference
});

// Analysis function for building counts and heights
function analyzeBuildings(aoi) {
  var scale = ee.Number(Map.getScale());
  
  var counts = annualMosaics.map(function(mosaic) {
    mosaic = ee.Image(mosaic);
    var year = mosaic.get('year');
    
    // Only consider pixels with significant building presence
    var buildingMask = mosaic.select('building_presence').gt(0.2);
    var maskedImage = mosaic.updateMask(buildingMask);
    
    // Calculate statistics for all bands at once
    var stats = maskedImage.select(['building_fractional_count', 'building_height', 'building_presence'])
        .reduceRegion({
          reducer: ee.Reducer.mean(),  // Using mean for all stats
          geometry: aoi,
          scale: scale,
          maxPixels: 1e13,
          bestEffort: true,
          crs: aoi.projection()
        });
    
    // Get the count of buildings (applying scale factor)
    var totalCount = ee.Number(stats.get('building_fractional_count'))
        .multiply(ee.Number(2).multiply(scale).pow(2));
    
    // Get height directly and multiply by 10 (if heights are in decimeters)
    var avgHeight = ee.Number(stats.get('building_height')).multiply(10);
    var avgFloors = avgHeight.divide(ee.Number(FLOOR_HEIGHT));
    
    // Building presence is already a mean value
    var presenceMean = ee.Number(stats.get('building_presence'));
    
    return ee.Dictionary({
      'year': year,
      'count': totalCount,
      'avgHeight': avgHeight,
      'avgFloors': avgFloors,
      'presence': presenceMean
    });
  });
  
  // Print detailed statistics
  counts.evaluate(function(countList) {
    if (!countList) {
      print('No results returned. Check the AOI and data availability.');
      return;
    }
    print('Detailed statistics:');
    countList.forEach(function(stat) {
      print('Year:', stat.year);
      print('Building count:', stat.count.toFixed(0));
      print('Average height (m):', stat.avgHeight.toFixed(2));
      print('Average floors:', stat.avgFloors.toFixed(2));
      print('Building presence:', stat.presence.toFixed(3));
      print('------------------------');
    });
  });
  
  // Create visualization chart
  var chartData = counts.map(function(result) {
    var dict = ee.Dictionary(result);
    return [dict.get('count'), 
            dict.get('avgHeight'),
            dict.get('avgFloors')];
  });
  
  return ui.Chart.array.values({
    array: chartData, 
    axis: 0,
    xLabels: YEARS.map(String)
  })
  .setChartType('ComboChart')
  .setOptions({
    title: 'Building Analysis Over Time',
    vAxes: {
      0: {title: 'Building Count'},
      1: {title: 'Average Height (m) / Floors'}
    },
    series: {
      0: {targetAxisIndex: 0, type: 'bars', color: '#669DF6', title: 'Building Count'},
      1: {targetAxisIndex: 1, type: 'line', color: '#E67C73', title: 'Avg Height (m)'},
      2: {targetAxisIndex: 1, type: 'line', color: '#4CAF50', title: 'Avg Floors'}
    },
    legend: {position: 'bottom'}
  });
}
// Setup UI Panel
var panel = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {width: '300px', position: 'top-right'}
});

// Add title and description
panel.add(ui.Label('Building Analysis Tool', {fontSize: '24px', fontWeight: 'bold'}));
panel.add(ui.Label(
  'Analyze building counts, heights, and floors over time\n' +
  'Draw a polygon to analyze an area of interest.',
  {fontSize: '14px', whiteSpace: 'pre'}
));

// Create drawing tools panel
var drawingTools = Map.drawingTools();
drawingTools.setShape('polygon');
drawingTools.setDrawModes(['polygon']);
drawingTools.layers().reset();

// Add drawing button
var drawButton = ui.Button({
  label: 'Draw Area for Analysis',
  onClick: function() {
    drawingTools.layers().reset();
    drawingTools.setShape('polygon');
    drawingTools.draw();
  }
});
panel.add(drawButton);

// Add analyze button
var analyzeButton = ui.Button({
  label: 'Analyze Selected Area',
  onClick: function() {
    if (drawingTools.layers().length() > 0) {
      var aoi = drawingTools.layers().get(0).getEeObject();
      
      // Print area size in square kilometers
      aoi.area().divide(1e6).evaluate(function(squareKm) {
        print('Area size:', squareKm.toFixed(2), 'square kilometers');
      });
      
      var chart = analyzeBuildings(aoi);
      print(chart);
    } else {
      print('Please draw an area first');
    }
  }
});
panel.add(analyzeButton);

// Add clear button
var clearButton = ui.Button({
  label: 'Clear',
  onClick: function() {
    drawingTools.layers().reset();
    print('Cleared analysis');
  }
});
panel.add(clearButton);

// Information panel
var infoPanel = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

var infoLabel = ui.Label(
  'Use the buttons to draw an area and analyze building statistics.\n' +
  'The analysis shows building counts, average heights, and estimated floor counts.\n' +
  'Floors are estimated assuming 3 meters per floor.',
  {whiteSpace: 'pre'}
);
infoPanel.add(infoLabel);

// Add explanation for colors
var legendPanel = ui.Panel({
  style: {
    padding: '8px 15px',
    position: 'bottom-right'
  }
});

var legendTitle = ui.Label('Legend', {fontWeight: 'bold'});
legendPanel.add(legendTitle);
legendPanel.add(ui.Label('Blue bars: Building Count'));
legendPanel.add(ui.Label('Red line: Average Height (m)'));
legendPanel.add(ui.Label('Green line: Average Floors'));

// Setup map
Map.setOptions('HYBRID');
Map.style().set('cursor', 'crosshair');

// Add panels to map
ui.root.add(panel);
Map.add(infoPanel);
Map.add(legendPanel);

// Initialize visualization layers
Map.setCenter(20, 0, 3);  // Center on Africa where we have coverage

// Add both presence and height layers for a current year (2023)
var currYear = 2023;
var initialMosaic = ee.Image(annualMosaics.get(YEARS.indexOf(currYear)));

Map.addLayer(
    initialMosaic.select('building_presence'),
    {min: 0, max: 1, palette: PRESENCE_PALETTE},
    'Building Presence 2023'
);

Map.addLayer(
    initialMosaic.select('building_height'),
    {min: 0, max: 30, palette: HEIGHT_PALETTE},
    'Building Heights 2023'
);

print('Draw a polygon in an area of interest to begin analysis.');
