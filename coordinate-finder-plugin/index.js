// plugins/coordinate-finder-plugin/index.js
(function (global) {
    function CoordinateFinder(options = {}) {
      const {
        buttonText = 'Hitta koordinater',
        crs = [],
        defs = {},
        crsNames = null,
        iconPath = 'img/png/droppe_orange.png',
        defaultZoom = 20,
        attachToId = null,
        projectionCode = 'EPSG:3857', // ny option: målkartprojektion för feature/centering
        logLevel = 'warn' // 'debug' | 'info' | 'warn' | 'error' | 'silent'
      } = options;
  
      function log(level, ...args) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
        if (!(level in levels)) level = 'info';
        if (levels[level] < levels[logLevel]) {
          if (level === 'error') console.error(...args);
          else if (level === 'warn') console.warn(...args);
          else if (level === 'info') console.info(...args);
          else console.debug(...args);
        }
      }
  
      const defaultCrsNames = {
        'EPSG:3857': 'Web Mercator',
        'EPSG:4326': 'WGS 84',
        'EPSG:3006': 'SWEREF 99 TM'
      };
      const mergedCrsNames = crsNames ? { ...defaultCrsNames, ...crsNames } : defaultCrsNames;
  
      const requiredCrs = ['EPSG:3006', 'EPSG:3857', 'EPSG:4326'];
      let userCrsArray = [];
      if (Array.isArray(crs)) userCrsArray = crs.slice();
      else if (typeof crs === 'string') userCrsArray = [crs];
      const crsList = requiredCrs.concat(userCrsArray.filter(c => !requiredCrs.includes(c)));
      let coordinateSystem = crsList.indexOf('EPSG:3006') >= 0 ? 'EPSG:3006' : (crsList[0] || 'EPSG:3857');
  
      if (defs && typeof defs === 'object' && global.proj4) {
        Object.keys(defs).forEach(k => {
          try { proj4.defs(k, defs[k]); log('info', 'proj4.defs registered for', k); } catch (e) { log('warn', 'proj4.defs failed for', k, e); }
        });
      }
  
      let viewer = null;
      let renderTargetId = null;
      let infoEl = null;
      let coordinateCounter = 1;
      let cachedVectorLayer = null;
      const listeners = [];
  
      function getMapSafe() {
        try {
          if (viewer && typeof viewer.getMap === 'function') return viewer.getMap();
          if (viewer && viewer.getMain && typeof viewer.getMain === 'function') {
            const main = viewer.getMain();
            if (main && typeof main.getMap === 'function') return main.getMap();
          }
          if (global.Origo && typeof Origo.api === 'function') {
            const api = Origo.api();
            if (api && api.getMap) return api.getMap();
          }
        } catch (e) { /* ignore */ }
        return null;
      }
  
      function getMapUtils() {
        try {
          if (global.Origo && typeof Origo.api === 'function') {
            const api = Origo.api();
            if (api && api.getMapUtils && typeof api.getMapUtils === 'function') return api.getMapUtils();
          }
          if (viewer && typeof viewer.getMapUtils === 'function') return viewer.getMapUtils();
          if (viewer && viewer.getMain && typeof viewer.getMain === 'function') {
            const main = viewer.getMain();
            if (main && typeof main.getMapUtils === 'function') return main.getMapUtils();
          }
        } catch (e) {}
        return null;
      }
  
      function transform(coords, fromEpsg, toEpsg) {
        if (!Array.isArray(coords) || coords.length < 2) {
          log('error', 'transform: invalid coords', coords);
          return null;
        }
        const mapUtils = getMapUtils();
        if (mapUtils && typeof mapUtils.transformCoordinate === 'function') {
          try {
            const out = mapUtils.transformCoordinate(coords, fromEpsg, toEpsg);
            log('debug', `Transformed using mapUtils from ${fromEpsg} to ${toEpsg}`, out);
            return out;
          } catch (e) { log('warn', 'mapUtils.transformCoordinate failed', e); }
        }
        try {
          const olObj = (global.Origo && Origo.ol) ? Origo.ol : (global.ol ? global.ol : null);
          if (olObj && olObj.proj && typeof olObj.proj.transform === 'function') {
            const out = olObj.proj.transform(coords, fromEpsg, toEpsg);
            log('debug', `Transformed using ol.proj.transform from ${fromEpsg} to ${toEpsg}`, out);
            return out;
          }
        } catch (e) { log('warn', 'ol.proj.transform failed', e); }
        if (typeof global.proj4 !== 'undefined') {
          try {
            const out = proj4(fromEpsg, toEpsg, coords);
            log('debug', `Transformed using proj4 from ${fromEpsg} to ${toEpsg}`, out);
            return out;
          } catch (e) { log('warn', 'proj4 transform failed', e); }
        } else { log('warn', 'proj4 not available for fallback transform'); }
        log('error', 'No transform available; returning null');
        return null;
      }
  
      function DMSToDecimal(deg, min = 0, sec = 0, dir = 'N') {
        const d = Number(deg);
        const m = Number(min) || 0;
        const s = Number(sec) || 0;
        if (Number.isNaN(d)) return NaN;
        let decimal = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600;
        if (String(dir).toUpperCase() === 'S' || String(dir).toUpperCase() === 'W') decimal = -decimal;
        return d < 0 ? -decimal : decimal;
      }
  
      function fmt(val, decimals = 3) {
        return (typeof val === 'number' && Number.isFinite(val)) ? Number(val.toFixed(decimals)) : val;
      }
  
      function createInfoWindow(attachToId) {
        if (infoEl) { infoEl.style.display = 'flex'; return infoEl; }
  
        infoEl = document.createElement('div');
        infoEl.className = 'o-info-window box-shadow padding-small coordinate-search-container';
        infoEl.setAttribute('role', 'dialog');
        infoEl.setAttribute('aria-label', 'Koordinatsök');
  
        const closeBtn = document.createElement('button');
        closeBtn.className = 'o-info-close icon';
        closeBtn.type = 'button';
        closeBtn.innerHTML = '<svg class="icon-smaller"><use xlink:href="#ic_close_24px"></use></svg>';
        closeBtn.addEventListener('click', closeInfoWindow);
        listeners.push({ el: closeBtn, ev: 'click', fn: closeInfoWindow });
  
        const content = document.createElement('div');
        content.className = 'o-info-content';
        const title = document.createElement('h3');
        title.id = 'coordinate-searchTitle';
        title.textContent = 'Koordinatsök';
        content.appendChild(title);
  
        const coordRow = document.createElement('div');
        coordRow.className = 'coord-input-row';
        const xInput = document.createElement('input'); xInput.type = 'number'; xInput.id = 'x-coordinate'; xInput.className = 'coord-input'; xInput.placeholder = 'E (lon) koordinat'; xInput.step = 'any';
        const yInput = document.createElement('input'); yInput.type = 'number'; yInput.id = 'y-coordinate'; yInput.className = 'coord-input'; yInput.placeholder = 'N (lat) koordinat'; yInput.step = 'any';
        const attrInput = document.createElement('input'); attrInput.type = 'text'; attrInput.id = 'coordinateAttribute'; attrInput.className = 'coord-input'; attrInput.placeholder = 'Punktnamn (valfritt)';
        coordRow.appendChild(xInput); coordRow.appendChild(yInput); coordRow.appendChild(attrInput);
        content.appendChild(coordRow);
  
        const dmsContainer = document.createElement('div');
        dmsContainer.className = 'dms-input-container';
        dmsContainer.style.display = (coordinateSystem && coordinateSystem.toUpperCase().indexOf('4326') >= 0) ? 'block' : 'none';
        const dmsHeader = document.createElement('h4'); dmsHeader.textContent = 'Eller ange i DMS format:'; dmsContainer.appendChild(dmsHeader);
        const dmsRow = document.createElement('div'); dmsRow.className = 'dms-row';
        const latGroup = document.createElement('div'); latGroup.className = 'dms-group';
        const latLabel = document.createElement('label'); latLabel.textContent = 'Latitude (DMS):'; latGroup.appendChild(latLabel);
        const latDeg = document.createElement('input'); latDeg.type = 'number'; latDeg.id = 'lat-deg'; latDeg.className = 'dms-input'; latDeg.placeholder = 'Grader'; latDeg.step = '1'; latDeg.min = '0'; latDeg.max = '90';
        const latMin = document.createElement('input'); latMin.type = 'number'; latMin.id = 'lat-min'; latMin.className = 'dms-input'; latMin.placeholder = 'Minuter'; latMin.step = '1'; latMin.min = '0'; latMin.max = '59';
        const latSec = document.createElement('input'); latSec.type = 'number'; latSec.id = 'lat-sec'; latSec.className = 'dms-input'; latSec.placeholder = 'Sekunder'; latSec.step = '0.001'; latSec.min = '0'; latSec.max = '59.999';
        const latDir = document.createElement('select'); latDir.id = 'lat-dir'; latDir.className = 'dms-select'; latDir.innerHTML = '<option value="N">N</option><option value="S">S</option>';
        latGroup.appendChild(latDeg); latGroup.appendChild(latMin); latGroup.appendChild(latSec); latGroup.appendChild(latDir);
  
        const lonGroup = document.createElement('div'); lonGroup.className = 'dms-group';
        const lonLabel = document.createElement('label'); lonLabel.textContent = 'Longitude (DMS):'; lonGroup.appendChild(lonLabel);
        const lonDeg = document.createElement('input'); lonDeg.type = 'number'; lonDeg.id = 'lon-deg'; lonDeg.className = 'dms-input'; lonDeg.placeholder = 'Grader'; lonDeg.step = '1'; lonDeg.min = '0'; lonDeg.max = '180';
        const lonMin = document.createElement('input'); lonMin.type = 'number'; lonMin.id = 'lon-min'; lonMin.className = 'dms-input'; lonMin.placeholder = 'Minuter'; lonMin.step = '1'; lonMin.min = '0'; lonMin.max = '59';
        const lonSec = document.createElement('input'); lonSec.type = 'number'; lonSec.id = 'lon-sec'; lonSec.className = 'dms-input'; lonSec.placeholder = 'Sekunder'; lonSec.step = '0.001'; lonSec.min = '0'; lonSec.max = '59.999';
        const lonDir = document.createElement('select'); lonDir.id = 'lon-dir'; lonDir.className = 'dms-select'; lonDir.innerHTML = '<option value="E">E</option><option value="W">W</option>';
        lonGroup.appendChild(lonDeg); lonGroup.appendChild(lonMin); lonGroup.appendChild(lonSec); lonGroup.appendChild(lonDir);
  
        dmsRow.appendChild(latGroup); dmsRow.appendChild(lonGroup); dmsContainer.appendChild(dmsRow); content.appendChild(dmsContainer);
  
        const controlsRow = document.createElement('div'); controlsRow.className = 'controls-row';
        const findBtn = document.createElement('button'); findBtn.id = 'findCoordinateBtn'; findBtn.className = 'o-btn'; findBtn.type = 'button'; findBtn.textContent = 'Hitta plats';
        const removeBtn = document.createElement('button'); removeBtn.id = 'removeCoordinateLayerBtn'; removeBtn.className = 'o-btn'; removeBtn.type = 'button'; removeBtn.textContent = 'Radera punkter';
        const crsWrap = document.createElement('div'); crsWrap.className = 'crs-select-wrap';
        const crsSelect = document.createElement('select'); crsSelect.id = 'crsSelect'; crsSelect.className = 'crs-select';
        crsList.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = mergedCrsNames[c] || c; crsSelect.appendChild(opt); });
        crsWrap.appendChild(crsSelect);
        controlsRow.appendChild(findBtn); controlsRow.appendChild(removeBtn); controlsRow.appendChild(crsWrap); content.appendChild(controlsRow);
  
        infoEl.appendChild(closeBtn); infoEl.appendChild(content);
  
        const attachEl = document.getElementById(attachToId || renderTargetId) || document.body;
        attachEl.appendChild(infoEl);
  
        crsSelect.value = coordinateSystem;
        const onCrsChange = function () {
          coordinateSystem = this.value;
          const cs = String(coordinateSystem).toUpperCase();
          if (cs.indexOf('4326') >= 0 || cs.indexOf('WGS') >= 0) dmsContainer.style.display = 'block';
          else dmsContainer.style.display = 'none';
          log('info', 'CRS changed to', coordinateSystem);
        };
        crsSelect.addEventListener('change', onCrsChange);
        listeners.push({ el: crsSelect, ev: 'change', fn: onCrsChange });
  
        const onFind = function () {
          const rawX = xInput.value;
          const rawY = yInput.value;
          const attribute = attrInput.value || '';
  
          const latDegV = latDeg.value; const latMinV = latMin.value; const latSecV = latSec.value; const latDirV = latDir.value;
          const lonDegV = lonDeg.value; const lonMinV = lonMin.value; const lonSecV = lonSec.value; const lonDirV = lonDir.value;
  
          let x = rawX !== '' ? parseFloat(rawX) : NaN;
          let y = rawY !== '' ? parseFloat(rawY) : NaN;
  
          const latDegNum = latDegV !== '' ? Number(latDegV) : NaN;
          const lonDegNum = lonDegV !== '' ? Number(lonDegV) : NaN;
          if (!Number.isNaN(latDegNum) && !Number.isNaN(lonDegNum)) {
            const latDecimal = DMSToDecimal(latDegNum, latMinV || 0, latSecV || 0, latDirV || 'N');
            const lonDecimal = DMSToDecimal(lonDegNum, lonMinV || 0, lonSecV || 0, lonDirV || 'E');
            y = latDecimal; x = lonDecimal;
            log('info', 'DMS converted to decimals', { x, y });
          }
  
          if (!Number.isFinite(x) || !Number.isFinite(y)) { log('warn', 'Ogiltiga koordinater, avbryter'); return; }
  
          const cs = String(coordinateSystem).toUpperCase();
          if (cs.indexOf('4326') >= 0 || cs.indexOf('WGS') >= 0) {
            if (Math.abs(y) > 90 || Math.abs(x) > 180) { log('warn', 'Lat/lon utanför giltigt intervall'); return; }
          }
  
          const inputEpsg = coordinateSystem;
          const inputCoords = [x, y];
          log('debug', 'Input coords:', inputCoords, 'inputEpsg:', inputEpsg);
  
          // Transform to projectionCode (nytt: använd projectionCode för geometry/centering)
          const transformedTarget = transform(inputCoords, inputEpsg, projectionCode);
          if (!transformedTarget || !Number.isFinite(transformedTarget[0]) || !Number.isFinite(transformedTarget[1])) {
            log('error', 'Transformation till target projection returnerade ogiltiga värden', transformedTarget);
            return;
          }
  
          // Transform also to EPSG:3006 for display if possible
          const coords3006 = transform(inputCoords, inputEpsg, 'EPSG:3006');
  
          const lines = [];
          lines.push(`${coordinateCounter}`);
          if (attribute && String(attribute).trim().length > 0) lines.push(String(attribute).trim());
          lines.push(`Input koordinat (${inputEpsg}):<br> E: ${fmt(inputCoords[0])} N: ${fmt(inputCoords[1])}`);
          if (coords3006 && Array.isArray(coords3006) && coords3006.length === 2 && Number.isFinite(coords3006[0]) && Number.isFinite(coords3006[1])) {
            lines.push(`SWEREF 99 TM (EPSG:3006):<br> E: ${fmt(coords3006[0])} N: ${fmt(coords3006[1])}`);
          } else if (inputEpsg === 'EPSG:3006') {
            lines.push(`SWEREF 99 TM (EPSG:3006):<br> E: ${fmt(inputCoords[0])} N: ${fmt(inputCoords[1])}`);
          } else {
            lines.push('SWEREF 99 TM (EPSG:3006): ej tillgänglig');
          }
          const propsNr = lines.join(' <br> ');
  
          const geojsonObject = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: transformedTarget },
              properties: { Nr: propsNr }
            }]
          };
  
          const map = getMapSafe();
          if (!map) { log('error', 'Kartobjektet kunde inte hittas'); return; }
  
          let mapProjectionCode = projectionCode;
          try {
            const mapView = map.getView && map.getView();
            if (mapView && mapView.getProjection && typeof mapView.getProjection === 'function') {
              mapProjectionCode = mapView.getProjection().getCode ? mapView.getProjection().getCode() : mapProjectionCode;
            }
          } catch (e) {}
  
          const format = Origo.ol.format.GeoJSON;
          const readOpts = {
            dataProjection: projectionCode,
            featureProjection: mapProjectionCode
          };
  
          try {
            let layer = null;
            if (cachedVectorLayer && map.getLayers) {
              const layersArray = map.getLayers().getArray();
              const exists = layersArray.find(l => l === cachedVectorLayer);
              layer = exists ? cachedVectorLayer : null;
              if (!layer) cachedVectorLayer = null;
            }
  
            if (layer) {
              const features = new format().readFeatures(geojsonObject, readOpts);
              layer.getSource().addFeatures(features);
            } else {
              const source = new Origo.ol.source.Vector({ features: new format().readFeatures(geojsonObject, readOpts) });
              const pointStyle = new Origo.ol.style.Style({
                image: new Origo.ol.style.Icon({
                  src: iconPath,
                  anchor: [0.5, 1],
                  anchorXUnits: 'fraction',
                  anchorYUnits: 'fraction',
                  scale: 1
                })
              });
              const vectorLayer = new Origo.ol.layer.Vector({
                source,
                name: 'Koordinatlager',
                title: 'Sökt koordinat',
                queryable: true,
                style: pointStyle
              });
              
              map.addLayer(vectorLayer);
              cachedVectorLayer = vectorLayer;
            }
          } catch (e) { log('error', 'Fel vid skapande/läggning av lager', e); return; }
  
          coordinateCounter++;
  
          try {
            // Försök centrera i samma projektion som map.getView för bästa resultat
            const mapView = map.getView && map.getView();
            if (mapView && typeof mapView.getProjection === 'function') {
              const viewProj = mapView.getProjection().getCode ? mapView.getProjection().getCode() : mapProjectionCode;
              // Om viewProj matchar projectionCode använd transformedTarget direkt, annars transformera dit
              let centerCoords = transformedTarget;
              if (viewProj !== projectionCode) {
                const toView = transform(transformedTarget, projectionCode, viewProj);
                if (toView && Number.isFinite(toView[0]) && Number.isFinite(toView[1])) centerCoords = toView;
              }
              mapView.setCenter(centerCoords);
              if (typeof defaultZoom === 'number') mapView.setZoom(defaultZoom);
            } else {
              // fallback: center using projectionCode coords if possible
              map.getView().setCenter(transformedTarget);
              if (typeof defaultZoom === 'number') map.getView().setZoom(defaultZoom);
            }
            log('info', 'Map centered');
          } catch (e) {
            try { Origo.api().getMap().getView().setCenter(transformedTarget); if (typeof defaultZoom === 'number') Origo.api().getMap().getView().setZoom(defaultZoom); log('info', 'Map centered via Origo API fallback'); }
            catch (err) { log('error', 'Could not center map', err); }
          }
        };
  
        findBtn.addEventListener('click', onFind);
        listeners.push({ el: findBtn, ev: 'click', fn: onFind });
  
        const onRemove = function () {
          const map = getMapSafe();
          if (!map) return;
          try {
            const layersArray = map.getLayers().getArray();
            const existing = layersArray.find(layer => layer.get('name') === 'Koordinatlager' || layer === cachedVectorLayer);
            if (existing) {
              existing.getSource().clear();
              try { map.removeLayer && map.removeLayer(existing); } catch (e) { try { map.getLayers().remove(existing); } catch (err) {} }
              cachedVectorLayer = null;
              coordinateCounter = 1;
              log('info', 'Koordinatlager cleared and counter reset');
            } else { log('info', 'Koordinatlager fanns inte'); }
          } catch (e) { log('warn', 'Fel vid radering av lager', e); }
        };
        removeBtn.addEventListener('click', onRemove);
        listeners.push({ el: removeBtn, ev: 'click', fn: onRemove });
  
        return infoEl;
      }
  
      function closeInfoWindow() {
        if (!infoEl) return;
        listeners.forEach(l => { try { l.el.removeEventListener(l.ev, l.fn); } catch (e) {} });
        listeners.length = 0;
        try { if (infoEl.parentNode) infoEl.parentNode.removeChild(infoEl); } catch (e) { infoEl.style.display = 'none'; }
        infoEl = null;
        log('info', 'Info window closed and cleaned up');
      }
  
      return Origo.ui.Component({
        name: 'coordinateFinder',
        onInit() {
          const coordinateFinderButton = Origo.ui.Button({
            cls: 'o-coordinateFinder padding-small icon-smaller round light box-shadow',
            click: () => { if (infoEl) closeInfoWindow(); else createInfoWindow(attachToId); },
            icon: '#fa-map-marker',
            tooltipText: buttonText,
            tooltipPlacement: 'east'
          });
          this.coordinateFinderButton = coordinateFinderButton;
        },
        onAdd(evt) {
          viewer = evt.target;
          try {
            if (!renderTargetId && viewer && viewer.getMain && viewer.getMain().getNavigation) {
              renderTargetId = viewer.getMain().getNavigation().getId();
            }
          } catch (e) {}
          this.addComponents([this.coordinateFinderButton]);
          this.render();
          log('info', 'CoordinateFinder component added; target:', renderTargetId);
        },
        render() {
          const htmlString = this.coordinateFinderButton.render();
          const el = Origo.ui.dom.html(htmlString);
          if (attachToId && document.getElementById(attachToId)) {
            document.getElementById(attachToId).appendChild(el);
          } else if (renderTargetId && document.getElementById(renderTargetId)) {
            document.getElementById(renderTargetId).appendChild(el);
          } else {
            document.body.appendChild(el);
            log('warn', 'Render target not found; appended to body');
          }
          this.dispatch('render');
        }
      });
    }
  
    global.CoordinateFinder = CoordinateFinder;
  })(window);
  
