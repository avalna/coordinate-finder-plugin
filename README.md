# coordinate-finder-plugin
This is a simple plugin that lets the user search for locations through inputting coordinates in your Origo Map instance.

## To use:
1. Clone
```bash
Git clone https://github.com/avalna/coordinate-finder-plugin.git
```
2. Place the folder in your plugins folder or other appropriate location
3. Refer to the plugin and its file in your index.html
Example:
```
<link rel="stylesheet" href="src/plugins/coordinate-finder-plugin/style.css">
```
```
<script src="src/plugins/coordinate-finder-plugin/index.js"></script>
```

5. Init the plugin like this:

```javascript
   <script type="text/javascript">
      var origo = Origo('index.json');
      origo.on('load', function(viewer) {
      var coordianteFinder = CoordinateFinder({
      crs: ['EPSG:3010'], // extra lokala CRS; EPSG:3006, EPSG:4326,  EPSG:3857 adderas alltid
      defs: {
        'EPSG:3010': '+proj=tmerc +lat_0=0 +lon_0=16.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +units=m +no_defs'
      },
      crsNames: {
      'EPSG:3010': 'SWEREF 99 16 30' 
    }
    });
  viewer.addComponent(coordianteFinder);
  });
</script>
```
description:
Default projectionCode for Origo map is used: EPSG:3857.

If you have changed your Origo Map instance projectionCode, then you need to specify that in the config to let the plugin know what EPSG is being used:

```
  var coordianteFinder = CoordinateFinder({
  projectionCode = 'EPSG:3010'
  });
  viewer.addComponent(coordianteFinder);
```

The plugin can be used without specifying addition crs like this:

```
  var coordianteFinder = CoordinateFinder({});
  viewer.addComponent(coordianteFinder);
```


