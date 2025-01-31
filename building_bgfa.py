import ee
import itertools
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

try:
    ee.Initialize(project='ee-milindsoni201')
except Exception as e:
    ee.Authenticate()
    ee.Initialize(project='ee-milindsoni201')

def split_region(region, splits_x=2, splits_y=2):
    """Split a rectangle into smaller rectangles."""
    coords = region.coordinates().get(0).getInfo()
    min_x = min(c[0] for c in coords)
    max_x = max(c[0] for c in coords)
    min_y = min(c[1] for c in coords)
    max_y = max(c[1] for c in coords)
    
    x_step = (max_x - min_x) / splits_x
    y_step = (max_y - min_y) / splits_y
    
    regions = []
    for i, j in itertools.product(range(splits_x), range(splits_y)):
        x1 = min_x + i * x_step
        x2 = min_x + (i + 1) * x_step
        y1 = min_y + j * y_step
        y2 = min_y + (j + 1) * y_step
        
        region = ee.Geometry.Rectangle([x1, y1, x2, y2])
        regions.append(region)
    
    return regions

def process_region(region, task_index):
    """Process a single region and export results."""
    try:
        # Filter buildings for this region
        filtered_buildings = buildings \
            .filterBounds(region) \
            .filter(ee.Filter.gte('confidence', 0.7))

        # Process buildings
        processed_buildings = filtered_buildings.map(get_heights_and_area)

        # Validate buildings
        validation_filters = [ee.Filter.notNull([f'height_{year}']) for year in years]
        valid_buildings = processed_buildings.filter(ee.Filter.Or(validation_filters))

        # Prepare export
        selectors = ['longitude', 'latitude', 'confidence', 'area_m2']
        selectors.extend([f'height_{year}' for year in years])
        selectors.extend([f'bgfa_{year}' for year in years])

        # Start export task with unique description
        task = ee.batch.Export.table.toDrive(
            collection=valid_buildings,
            description=f'pune_buildings_part_{task_index}',
            fileFormat='CSV',
            folder='Pune_Building_Analysis',
            selectors=selectors
        )
        task.start()
        return task
    except Exception as e:
        print(f"Error processing region {task_index}: {str(e)}")
        return None

def monitor_tasks(tasks):
    """Monitor multiple export tasks."""
    active_tasks = tasks.copy()
    while active_tasks:
        for task in active_tasks[:]:  # Iterate over a copy of the list
            status = task.status()
            if status['state'] in ['COMPLETED', 'FAILED', 'CANCELLED']:
                print(f"Task {status['description']}: {status['state']}")
                active_tasks.remove(task)
            else:
                print(f"Task {status['description']}: {status['state']}")
        if active_tasks:
            time.sleep(30)

def main():
    # Define Pune region
    pune_coords = {
        'minLon': 73.8500,
        'minLat': 18.5200,
        'maxLon': 73.8600,
        'maxLat': 18.5300
    }

    pune_region = ee.Geometry.Rectangle([
        pune_coords['minLon'], pune_coords['minLat'],
        pune_coords['maxLon'], pune_coords['maxLat']
    ])

    # Split region into smaller chunks (4x4 grid = 16 parts)
    regions = split_region(pune_region, splits_x=4, splits_y=4)
    
    # Process regions in parallel
    tasks = []
    with ThreadPoolExecutor(max_workers=16) as executor:
        future_to_region = {
            executor.submit(process_region, region, i): i 
            for i, region in enumerate(regions)
        }
        
        for future in as_completed(future_to_region):
            region_index = future_to_region[future]
            try:
                task = future.result()
                if task:
                    tasks.append(task)
                    print(f"Started task for region {region_index}")
            except Exception as e:
                print(f"Region {region_index} generated an exception: {str(e)}")

    # Monitor all tasks
    print("\nMonitoring export tasks...")
    monitor_tasks(tasks)

if __name__ == "__main__":
    main()
