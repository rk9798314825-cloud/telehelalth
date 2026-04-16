import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from './api';

export default function DicomViewer({ reportId, findings }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Basic controls
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Image processing
  const [activeFilter, setActiveFilter] = useState('none');
  const [toolTab, setToolTab] = useState('basic');
  const [processing, setProcessing] = useState(false);

  // Histogram
  const [showHistogram, setShowHistogram] = useState(false);
  const [histData, setHistData] = useState(null);

  // Measurement
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measurements, setMeasurements] = useState([]);

  // Annotation
  const [annotating, setAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [annotationText, setAnnotationText] = useState('');

  // ROI (Region of Interest) — now drag-based
  const [drawingROI, setDrawingROI] = useState(false);
  const [isDraggingROI, setIsDraggingROI] = useState(false);
  const [roiStart, setRoiStart] = useState(null);
  const [roiEnd, setRoiEnd] = useState(null);
  const [roiStats, setRoiStats] = useState(null);

  // Windowing presets
  const [windowPreset, setWindowPreset] = useState('default');

  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const originalImageData = useRef(null);

  // Refs to keep latest state accessible inside mouse-event handlers
  // without stale closures
  const roiStartRef = useRef(null);
  const isDraggingROIRef = useRef(false);
  const drawingROIRef = useRef(false);
  const measuringRef = useRef(false);
  const measurePointsRef = useRef([]);
  const annotatingRef = useRef(false);
  const annotationTextRef = useRef('');
  const annotationsRef = useRef([]);
  const measurementsRef = useRef([]);

  // Keep refs in sync with state
  useEffect(() => { roiStartRef.current = roiStart; }, [roiStart]);
  useEffect(() => { isDraggingROIRef.current = isDraggingROI; }, [isDraggingROI]);
  useEffect(() => { drawingROIRef.current = drawingROI; }, [drawingROI]);
  useEffect(() => { measuringRef.current = measuring; }, [measuring]);
  useEffect(() => { measurePointsRef.current = measurePoints; }, [measurePoints]);
  useEffect(() => { annotatingRef.current = annotating; }, [annotating]);
  useEffect(() => { annotationTextRef.current = annotationText; }, [annotationText]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { measurementsRef.current = measurements; }, [measurements]);

  useEffect(() => {
    loadDicom();
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [reportId]);

  const loadDicom = async () => {
    setLoading(true);
    setError('');
    try {
      const [imgRes, metaRes] = await Promise.all([
        api.get('/dicom/view/' + reportId, { responseType: 'blob' }),
        api.get('/dicom/metadata/' + reportId)
      ]);
      const url = URL.createObjectURL(imgRes.data);
      setImgUrl(url);
      setMetadata(metaRes.data.metadata);

      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        initCanvas(img);
      };
      img.src = url;
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load DICOM');
    }
    setLoading(false);
  };

  const initCanvas = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    originalImageData.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = img.width;
      overlay.height = img.height;
    }
  };

  // ═══════════════════════════════════════════
  // COORDINATE HELPER
  // ═══════════════════════════════════════════

  /**
   * Converts a mouse/pointer event position to canvas pixel coordinates,
   * accounting for any CSS scaling of the canvas element.
   */
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // ═══════════════════════════════════════════
  // IMAGE PROCESSING FILTERS
  // ═══════════════════════════════════════════

  const getImageData = () => {
    if (!originalImageData.current) return null;
    return new ImageData(
      new Uint8ClampedArray(originalImageData.current.data),
      originalImageData.current.width,
      originalImageData.current.height
    );
  };

  const applyToCanvas = (imageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  };

  const applyGrayscale = useCallback(() => {
    const data = getImageData(); if (!data) return;
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const avg = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = avg;
    }
    applyToCanvas(data);
  }, []);

  const applyEdgeDetection = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w = data.width, h = data.height, src = data.data;
    const output = new Uint8ClampedArray(src.length);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      gray[i] = 0.299 * src[i*4] + 0.587 * src[i*4+1] + 0.114 * src[i*4+2];
    const sobelX = [-1,0,1,-2,0,2,-1,0,1], sobelY = [-1,-2,-1,0,0,0,1,2,1];
    for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
      let gx=0, gy=0;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const idx=(y+ky)*w+(x+kx), ki=(ky+1)*3+(kx+1);
        gx+=gray[idx]*sobelX[ki]; gy+=gray[idx]*sobelY[ki];
      }
      const mag=Math.min(255,Math.sqrt(gx*gx+gy*gy)), oi=(y*w+x)*4;
      output[oi]=output[oi+1]=output[oi+2]=mag; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyGaussianBlur = useCallback((radius=3) => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width, h=data.height, d=data.data;
    const size=radius*2+1, kernel=[], sigma=radius/3; let sum=0;
    for (let y=-radius;y<=radius;y++) for (let x=-radius;x<=radius;x++) {
      const val=Math.exp(-(x*x+y*y)/(2*sigma*sigma)); kernel.push(val); sum+=val;
    }
    kernel.forEach((v,i)=>kernel[i]=v/sum);
    const output=new Uint8ClampedArray(d.length);
    for (let y=radius;y<h-radius;y++) for (let x=radius;x<w-radius;x++) {
      let r=0,g=0,b=0,ki=0;
      for (let ky=-radius;ky<=radius;ky++) for (let kx=-radius;kx<=radius;kx++) {
        const si=((y+ky)*w+(x+kx))*4;
        r+=d[si]*kernel[ki]; g+=d[si+1]*kernel[ki]; b+=d[si+2]*kernel[ki]; ki++;
      }
      const oi=(y*w+x)*4; output[oi]=r; output[oi+1]=g; output[oi+2]=b; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applySharpen = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width, h=data.height, d=data.data, kernel=[0,-1,0,-1,5,-1,0,-1,0];
    const output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      let r=0,g=0,b=0,ki=0;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const si=((y+ky)*w+(x+kx))*4;
        r+=d[si]*kernel[ki]; g+=d[si+1]*kernel[ki]; b+=d[si+2]*kernel[ki]; ki++;
      }
      const oi=(y*w+x)*4;
      output[oi]=Math.min(255,Math.max(0,r)); output[oi+1]=Math.min(255,Math.max(0,g));
      output[oi+2]=Math.min(255,Math.max(0,b)); output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyHistogramEqualization = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const d=data.data, total=d.length/4;
    const hist=new Array(256).fill(0);
    for (let i=0;i<d.length;i+=4) hist[Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])]++;
    const cdf=new Array(256); cdf[0]=hist[0];
    for (let i=1;i<256;i++) cdf[i]=cdf[i-1]+hist[i];
    const cdfMin=cdf.find(v=>v>0);
    const lookup=new Array(256);
    for (let i=0;i<256;i++) lookup[i]=Math.round(((cdf[i]-cdfMin)/(total-cdfMin))*255);
    for (let i=0;i<d.length;i+=4) {
      const eq=lookup[Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])];
      d[i]=d[i+1]=d[i+2]=eq;
    }
    applyToCanvas(data); setProcessing(false);
  }, []);

  const applyThreshold = useCallback((threshold=128) => {
    const data = getImageData(); if (!data) return;
    const d=data.data;
    for (let i=0;i<d.length;i+=4) {
      const val=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]>=threshold?255:0;
      d[i]=d[i+1]=d[i+2]=val;
    }
    applyToCanvas(data);
  }, []);

  const applyMedianFilter = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width,h=data.height,d=data.data,output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      const rA=[],gA=[],bA=[];
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const si=((y+ky)*w+(x+kx))*4; rA.push(d[si]); gA.push(d[si+1]); bA.push(d[si+2]);
      }
      rA.sort((a,b)=>a-b); gA.sort((a,b)=>a-b); bA.sort((a,b)=>a-b);
      const mid=Math.floor(rA.length/2), oi=(y*w+x)*4;
      output[oi]=rA[mid]; output[oi+1]=gA[mid]; output[oi+2]=bA[mid]; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyEmboss = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width,h=data.height,d=data.data,kernel=[-2,-1,0,-1,1,1,0,1,2];
    const output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      let r=0,g=0,b=0,ki=0;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const si=((y+ky)*w+(x+kx))*4;
        r+=d[si]*kernel[ki]; g+=d[si+1]*kernel[ki]; b+=d[si+2]*kernel[ki]; ki++;
      }
      const oi=(y*w+x)*4;
      output[oi]=Math.min(255,Math.max(0,r+128)); output[oi+1]=Math.min(255,Math.max(0,g+128));
      output[oi+2]=Math.min(255,Math.max(0,b+128)); output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyHeatMap = useCallback(() => {
    const data = getImageData(); if (!data) return;
    const d=data.data;
    for (let i=0;i<d.length;i+=4) {
      const t=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
      if (t<0.25)      { d[i]=0; d[i+1]=Math.round(t*4*255); d[i+2]=255; }
      else if (t<0.5)  { d[i]=0; d[i+1]=255; d[i+2]=Math.round((1-(t-0.25)*4)*255); }
      else if (t<0.75) { d[i]=Math.round((t-0.5)*4*255); d[i+1]=255; d[i+2]=0; }
      else             { d[i]=255; d[i+1]=Math.round((1-(t-0.75)*4)*255); d[i+2]=0; }
    }
    applyToCanvas(data);
  }, []);

  const applyLaplacian = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width,h=data.height,d=data.data,kernel=[0,1,0,1,-4,1,0,1,0];
    const gray=new Float32Array(w*h);
    for (let i=0;i<w*h;i++) gray[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
    const output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      let sum=0,ki=0;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) sum+=gray[(y+ky)*w+(x+kx)]*kernel[ki++];
      const val=Math.min(255,Math.max(0,Math.abs(sum))), oi=(y*w+x)*4;
      output[oi]=output[oi+1]=output[oi+2]=val; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyErosion = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width,h=data.height,d=data.data,output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      let minVal=255;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const si=((y+ky)*w+(x+kx))*4;
        minVal=Math.min(minVal,0.299*d[si]+0.587*d[si+1]+0.114*d[si+2]);
      }
      const oi=(y*w+x)*4; output[oi]=output[oi+1]=output[oi+2]=minVal; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyDilation = useCallback(() => {
    const data = getImageData(); if (!data) return;
    setProcessing(true);
    const w=data.width,h=data.height,d=data.data,output=new Uint8ClampedArray(d.length);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      let maxVal=0;
      for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
        const si=((y+ky)*w+(x+kx))*4;
        maxVal=Math.max(maxVal,0.299*d[si]+0.587*d[si+1]+0.114*d[si+2]);
      }
      const oi=(y*w+x)*4; output[oi]=output[oi+1]=output[oi+2]=maxVal; output[oi+3]=255;
    }
    data.data.set(output); applyToCanvas(data); setProcessing(false);
  }, []);

  const applyGamma = useCallback((gamma=1.5) => {
    const data = getImageData(); if (!data) return;
    const d=data.data, invGamma=1/gamma;
    for (let i=0;i<d.length;i+=4) {
      d[i]=Math.round(255*Math.pow(d[i]/255,invGamma));
      d[i+1]=Math.round(255*Math.pow(d[i+1]/255,invGamma));
      d[i+2]=Math.round(255*Math.pow(d[i+2]/255,invGamma));
    }
    applyToCanvas(data);
  }, []);

  const applyNegative = useCallback(() => {
    const data = getImageData(); if (!data) return;
    const d=data.data;
    for (let i=0;i<d.length;i+=4) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
    applyToCanvas(data);
  }, []);

  // ═══════════════════════════════════════════
  // OVERLAY DRAWING
  // ═══════════════════════════════════════════

  /**
   * Redraws everything on the overlay canvas.
   * Accepts optional explicit roi coords so it can be called
   * during live drag without waiting for React state to flush.
   */
  const drawOverlay = useCallback(({
    mList, aList, roi
  } = {}) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const activeMeasurements = mList ?? measurementsRef.current;
    const activeAnnotations  = aList ?? annotationsRef.current;
    const activeRoi = roi ?? (roiStartRef.current && roiEnd ? { start: roiStartRef.current, end: roiEnd } : null);

    // Draw measurements
    activeMeasurements.forEach(m => {
      ctx.beginPath(); ctx.moveTo(m.p1.x,m.p1.y); ctx.lineTo(m.p2.x,m.p2.y);
      ctx.strokeStyle='#00ff00'; ctx.lineWidth=2; ctx.stroke();
      const midX=(m.p1.x+m.p2.x)/2, midY=(m.p1.y+m.p2.y)/2;
      ctx.fillStyle='#00ff00'; ctx.font='14px Arial'; ctx.fillText(m.distance+' px',midX+5,midY-5);
      [m.p1,m.p2].forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#00ff00';ctx.fill();});
    });

    // Draw annotations
    activeAnnotations.forEach(a => {
      ctx.fillStyle='#ffff00'; ctx.font='13px Arial'; ctx.fillText(a.text,a.x+8,a.y);
      ctx.beginPath(); ctx.arc(a.x,a.y,4,0,Math.PI*2); ctx.fillStyle='#ffff00'; ctx.fill();
    });

    // Draw ROI rectangle
    if (activeRoi?.start && activeRoi?.end) {
      const { start, end } = activeRoi;
      const rx=Math.min(start.x,end.x), ry=Math.min(start.y,end.y);
      const rw=Math.abs(end.x-start.x), rh=Math.abs(end.y-start.y);
      // Semi-transparent fill
      ctx.fillStyle='rgba(255,60,60,0.08)';
      ctx.fillRect(rx,ry,rw,rh);
      // Dashed border
      ctx.beginPath(); ctx.rect(rx,ry,rw,rh);
      ctx.strokeStyle='#ff3c3c'; ctx.lineWidth=2;
      ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
      // Corner handles
      [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([cx,cy])=>{
        ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2);
        ctx.fillStyle='#ff3c3c'; ctx.fill();
      });
      // Size label
      ctx.fillStyle='#ff3c3c'; ctx.font='bold 12px Arial';
      ctx.fillText(`${Math.round(rw)} × ${Math.round(rh)} px`, rx+4, ry-6);
    }
  }, [roiEnd]);

  // ═══════════════════════════════════════════
  // HISTOGRAM
  // ═══════════════════════════════════════════

  const computeHistogram = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const rH=new Array(256).fill(0), gH=new Array(256).fill(0),
          bH=new Array(256).fill(0), grH=new Array(256).fill(0);
    for (let i=0;i<data.length;i+=4) {
      rH[data[i]]++; gH[data[i+1]]++; bH[data[i+2]]++;
      grH[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++;
    }
    setHistData({ r:rH, g:gH, b:bH, gray:grH }); setShowHistogram(true);
  }, []);

  // ═══════════════════════════════════════════
  // ROI STATS
  // ═══════════════════════════════════════════

  const computeROIStats = useCallback((start, end) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const x1=Math.min(start.x,end.x), y1=Math.min(start.y,end.y);
    const w=Math.abs(end.x-start.x), h=Math.abs(end.y-start.y);
    if (w<2||h<2) return;
    const regionData=canvas.getContext('2d').getImageData(x1,y1,w,h).data;
    let sum=0, count=0, min=255, max=0; const values=[];
    for (let i=0;i<regionData.length;i+=4) {
      const g=0.299*regionData[i]+0.587*regionData[i+1]+0.114*regionData[i+2];
      sum+=g; min=Math.min(min,g); max=Math.max(max,g); values.push(g); count++;
    }
    const mean=sum/count;
    const stdDev=Math.sqrt(values.reduce((a,v)=>a+(v-mean)*(v-mean),0)/count);
    setRoiStats({
      area: `${Math.round(w)} × ${Math.round(h)} px`,
      pixels: count,
      mean: mean.toFixed(1),
      stdDev: stdDev.toFixed(1),
      min: Math.round(min),
      max: Math.round(max)
    });
  }, []);

  // ═══════════════════════════════════════════
  // MOUSE EVENT HANDLERS (drag-based ROI)
  // ═══════════════════════════════════════════

  const handleMouseDown = useCallback((e) => {
    if (!drawingROIRef.current) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setRoiStart(coords);
    setRoiEnd(coords);
    setRoiStats(null);
    setIsDraggingROI(true);
    roiStartRef.current = coords;
    isDraggingROIRef.current = true;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingROIRef.current || !drawingROIRef.current) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setRoiEnd(coords);
    // Draw live preview directly (bypass state timing)
    drawOverlay({ roi: { start: roiStartRef.current, end: coords } });
  }, [drawOverlay]);

  const handleMouseUp = useCallback((e) => {
    if (!isDraggingROIRef.current || !drawingROIRef.current) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setRoiEnd(coords);
    setIsDraggingROI(false);
    isDraggingROIRef.current = false;
    // Finalise
    if (roiStartRef.current) {
      computeROIStats(roiStartRef.current, coords);
      drawOverlay({ roi: { start: roiStartRef.current, end: coords } });
    }
    // Optionally exit drawing mode after one ROI is drawn
    // setDrawingROI(false);
  }, [drawOverlay, computeROIStats]);

  // ═══════════════════════════════════════════
  // CLICK HANDLER (measurement & annotation)
  // ═══════════════════════════════════════════

  const handleCanvasClick = useCallback((e) => {
    // ROI is handled by mousedown/move/up — skip here
    if (drawingROIRef.current) return;

    const coords = getCanvasCoords(e);
    const { x, y } = coords;

    if (measuringRef.current) {
      if (measurePointsRef.current.length === 0) {
        setMeasurePoints([{ x, y }]);
      } else {
        const p1 = measurePointsRef.current[0];
        const dist = Math.sqrt((x-p1.x)**2+(y-p1.y)**2);
        const newM = [...measurementsRef.current, { p1, p2:{x,y}, distance:dist.toFixed(1) }];
        setMeasurements(newM);
        setMeasurePoints([]);
        drawOverlay({ mList: newM });
      }
    }

    if (annotatingRef.current && annotationTextRef.current) {
      const newA = [...annotationsRef.current, { x, y, text: annotationTextRef.current }];
      setAnnotations(newA);
      setAnnotationText('');
      drawOverlay({ aList: newA });
    }
  }, [drawOverlay]);

  // ═══════════════════════════════════════════
  // WINDOWING PRESETS
  // ═══════════════════════════════════════════

  const applyWindowPreset = (preset) => {
    setWindowPreset(preset);
    switch (preset) {
      case 'bone':        setBrightness(60);  setContrast(300); setInvert(false); break;
      case 'lung':        setBrightness(200); setContrast(150); setInvert(true);  break;
      case 'brain':       setBrightness(120); setContrast(200); setInvert(false); break;
      case 'abdomen':     setBrightness(130); setContrast(180); setInvert(false); break;
      case 'soft_tissue': setBrightness(150); setContrast(160); setInvert(false); break;
      default:            setBrightness(100); setContrast(100); setInvert(false);
    }
  };

  const resetAll = () => {
    setZoom(1); setBrightness(100); setContrast(100); setInvert(false);
    setRotation(0); setFlipH(false); setFlipV(false);
    setActiveFilter('none'); setWindowPreset('default');
    setMeasurements([]); setAnnotations([]);
    setRoiStart(null); setRoiEnd(null); setRoiStats(null);
    setMeasuring(false); setAnnotating(false); setDrawingROI(false); setIsDraggingROI(false);
    setShowHistogram(false);
    if (imageRef.current) initCanvas(imageRef.current);
    const overlay = overlayCanvasRef.current;
    if (overlay) overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  };

  const applyFilter = (name) => {
    setActiveFilter(name);
    if (imageRef.current) initCanvas(imageRef.current);
    setTimeout(() => {
      switch (name) {
        case 'grayscale': applyGrayscale(); break;
        case 'edge':      applyEdgeDetection(); break;
        case 'blur':      applyGaussianBlur(3); break;
        case 'sharpen':   applySharpen(); break;
        case 'histEq':    applyHistogramEqualization(); break;
        case 'threshold': applyThreshold(128); break;
        case 'median':    applyMedianFilter(); break;
        case 'emboss':    applyEmboss(); break;
        case 'heatmap':   applyHeatMap(); break;
        case 'laplacian': applyLaplacian(); break;
        case 'erosion':   applyErosion(); break;
        case 'dilation':  applyDilation(); break;
        case 'gamma':     applyGamma(1.5); break;
        case 'negative':  applyNegative(); break;
        default: break;
      }
    }, 50);
  };

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

  if (loading) return (
    <div className="card text-center py-10">
      <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
      <p>Loading DICOM...</p>
    </div>
  );

  if (error) return (
    <div className="card text-center py-10">
      <div className="text-4xl mb-2">⚠️</div>
      <p className="text-red-600">{error}</p>
    </div>
  );

  const toolTabs = [
    { id:'basic',   label:'🎛️ Basic' },
    { id:'filters', label:'🎨 Filters' },
    { id:'medical', label:'🏥 Medical' },
    { id:'morph',   label:'🔬 Morphology' },
    { id:'tools',   label:'📐 Tools' },
    { id:'info',    label:'📋 Info' },
  ];

  const filterButtons = [
    { id:'none',      label:'Original',      icon:'🖼️' },
    { id:'grayscale', label:'Grayscale',      icon:'⬛' },
    { id:'edge',      label:'Edge Detect',    icon:'📐' },
    { id:'blur',      label:'Gaussian Blur',  icon:'🌫️' },
    { id:'sharpen',   label:'Sharpen',        icon:'🔪' },
    { id:'histEq',    label:'Hist. Equal.',   icon:'📊' },
    { id:'threshold', label:'Threshold',      icon:'⬜' },
    { id:'median',    label:'Median Filter',  icon:'🧹' },
    { id:'emboss',    label:'Emboss',         icon:'🏔️' },
    { id:'heatmap',   label:'Heat Map',       icon:'🌡️' },
    { id:'laplacian', label:'Laplacian',      icon:'〰️' },
    { id:'negative',  label:'Negative',       icon:'🔄' },
    { id:'gamma',     label:'Gamma',          icon:'☀️' },
  ];

  const windowPresets = [
    { id:'default',     label:'Default' },
    { id:'bone',        label:'🦴 Bone' },
    { id:'lung',        label:'🫁 Lung' },
    { id:'brain',       label:'🧠 Brain' },
    { id:'abdomen',     label:'🫃 Abdomen' },
    { id:'soft_tissue', label:'💪 Soft Tissue' },
  ];

  // Cursor style for the canvas area
  const canvasCursor = drawingROI
    ? (isDraggingROI ? 'nw-resize' : 'crosshair')
    : measuring || annotating
      ? 'crosshair'
      : 'default';

  return (
    <div className="space-y-4 fade-in">
      {processing && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          Processing image...
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4">
        {/* ═══ LEFT PANEL: TOOLBOX ═══ */}
        <div className="md:col-span-1 space-y-3">
          <div className="flex flex-wrap gap-1">
            {toolTabs.map(t => (
              <button key={t.id} onClick={() => setToolTab(t.id)}
                className={'px-2 py-1 rounded text-xs font-medium transition ' +
                  (toolTab===t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {t.label}
              </button>
            ))}
          </div>

          {/* BASIC CONTROLS */}
          {toolTab==='basic' && (
            <div className="card space-y-3">
              <h3 className="font-bold text-sm">🎛️ Basic Controls</h3>
              {[
                { label:'Zoom', value:zoom, min:0.3, max:5, step:0.1, fmt:v=>`${Math.round(v*100)}%`, set:v=>setZoom(parseFloat(v)) },
                { label:'Brightness', value:brightness, min:0, max:400, step:1, fmt:v=>`${v}%`, set:v=>setBrightness(parseInt(v)) },
                { label:'Contrast', value:contrast, min:0, max:400, step:1, fmt:v=>`${v}%`, set:v=>setContrast(parseInt(v)) },
                { label:'Rotation', value:rotation, min:0, max:360, step:1, fmt:v=>`${v}°`, set:v=>setRotation(parseInt(v)) },
              ].map(({ label, value, min, max, step, fmt, set }) => (
                <div key={label}>
                  <label className="text-xs font-medium flex justify-between"><span>{label}</span><span>{fmt(value)}</span></label>
                  <input type="range" min={min} max={max} step={step} value={value} onChange={e=>set(e.target.value)} className="w-full" />
                </div>
              ))}
              <div className="flex gap-2">
                {[['Invert',invert,setInvert],['Flip H',flipH,setFlipH],['Flip V',flipV,setFlipV]].map(([label,val,set])=>(
                  <label key={label} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={val} onChange={e=>set(e.target.checked)} className="rounded" />{label}
                  </label>
                ))}
              </div>
              <button onClick={resetAll} className="btn-gray w-full text-xs">🔄 Reset All</button>
            </div>
          )}

          {/* FILTERS */}
          {toolTab==='filters' && (
            <div className="card space-y-2">
              <h3 className="font-bold text-sm">🎨 Image Filters</h3>
              <div className="grid grid-cols-2 gap-1">
                {filterButtons.map(f=>(
                  <button key={f.id} onClick={()=>applyFilter(f.id)}
                    className={'px-2 py-2 rounded-lg text-xs font-medium transition text-left '+(activeFilter===f.id?'bg-blue-100 text-blue-700 ring-1 ring-blue-400':'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
                    <span className="mr-1">{f.icon}</span>{f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* MEDICAL PRESETS */}
          {toolTab==='medical' && (
            <div className="card space-y-2">
              <h3 className="font-bold text-sm">🏥 Window Presets</h3>
              <p className="text-xs text-gray-500">Standard medical imaging windows</p>
              <div className="space-y-1">
                {windowPresets.map(w=>(
                  <button key={w.id} onClick={()=>applyWindowPreset(w.id)}
                    className={'w-full px-3 py-2 rounded-lg text-xs font-medium text-left transition '+(windowPreset===w.id?'bg-blue-100 text-blue-700':'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
                    {w.label}
                  </button>
                ))}
              </div>
              <div className="border-t pt-2 mt-2">
                <h4 className="text-xs font-semibold mb-1">Quick Enhance</h4>
                <div className="grid grid-cols-2 gap-1">
                  <button onClick={()=>applyHistogramEqualization()} className="btn-gray text-xs py-1">Auto Level</button>
                  <button onClick={()=>applySharpen()} className="btn-gray text-xs py-1">Sharpen</button>
                  <button onClick={()=>applyGamma(0.7)} className="btn-gray text-xs py-1">Brighten</button>
                  <button onClick={()=>applyGamma(1.8)} className="btn-gray text-xs py-1">Darken</button>
                </div>
              </div>
            </div>
          )}

          {/* MORPHOLOGY */}
          {toolTab==='morph' && (
            <div className="card space-y-2">
              <h3 className="font-bold text-sm">🔬 Morphological Ops</h3>
              <p className="text-xs text-gray-500">Used for structure analysis in medical scans</p>
              <button onClick={()=>applyFilter('erosion')} className="btn-gray w-full text-xs">⊖ Erosion</button>
              <button onClick={()=>applyFilter('dilation')} className="btn-gray w-full text-xs">⊕ Dilation</button>
              <button onClick={()=>{applyFilter('erosion');setTimeout(()=>applyDilation(),100);}} className="btn-gray w-full text-xs">⊙ Opening</button>
              <button onClick={()=>{applyFilter('dilation');setTimeout(()=>applyErosion(),100);}} className="btn-gray w-full text-xs">⊘ Closing</button>
              <div className="border-t pt-2">
                <h4 className="text-xs font-semibold mb-1">Segmentation</h4>
                <button onClick={()=>applyFilter('threshold')} className="btn-gray w-full text-xs mb-1">Binary Threshold</button>
                <button onClick={()=>applyFilter('edge')} className="btn-gray w-full text-xs">Edge Detection</button>
              </div>
            </div>
          )}

          {/* TOOLS */}
          {toolTab==='tools' && (
            <div className="card space-y-2">
              <h3 className="font-bold text-sm">📐 Measurement & Annotation</h3>

              {/* Measure */}
              <button onClick={()=>{setMeasuring(!measuring);setAnnotating(false);setDrawingROI(false);setIsDraggingROI(false);}}
                className={'w-full text-xs py-2 rounded-lg font-medium '+(measuring?'bg-green-100 text-green-700 ring-1 ring-green-400':'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
                📏 {measuring?'Measuring… (click 2 points)':'Measure Distance'}
              </button>

              {/* ROI — drag-to-draw */}
              <div className="space-y-1">
                <button
                  onClick={()=>{
                    const next=!drawingROI;
                    setDrawingROI(next);
                    setMeasuring(false); setAnnotating(false);
                    if (!next) { setIsDraggingROI(false); setRoiStart(null); setRoiEnd(null); setRoiStats(null); drawOverlay({}); }
                  }}
                  className={'w-full text-xs py-2 rounded-lg font-medium '+(drawingROI?'bg-red-100 text-red-700 ring-1 ring-red-400':'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
                  ▢ {drawingROI?'Click & drag on image to draw ROI':'Region of Interest (ROI)'}
                </button>
                {drawingROI && (
                  <p className="text-xs text-red-500 text-center">
                    {isDraggingROI ? '🖱️ Release to finish' : '🖱️ Press & drag to select area'}
                  </p>
                )}
                {roiStart && roiEnd && !drawingROI && (
                  <button onClick={()=>{setRoiStart(null);setRoiEnd(null);setRoiStats(null);drawOverlay({});}}
                    className="btn-gray w-full text-xs">✕ Clear ROI</button>
                )}
              </div>

              {/* Annotation */}
              <div className="space-y-1">
                <input className="input text-xs" placeholder="Annotation text…" value={annotationText} onChange={e=>setAnnotationText(e.target.value)} />
                <button onClick={()=>{setAnnotating(!annotating);setMeasuring(false);setDrawingROI(false);setIsDraggingROI(false);}}
                  disabled={!annotationText}
                  className={'w-full text-xs py-2 rounded-lg font-medium '+(annotating?'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-400':'bg-gray-50 text-gray-600 hover:bg-gray-100')}>
                  📝 {annotating?'Click image to place annotation':'Add Annotation'}
                </button>
              </div>

              <button onClick={computeHistogram} className="btn-gray w-full text-xs">📊 Show Histogram</button>

              {/* ROI Stats */}
              {roiStats && (
                <div className="bg-red-50 rounded-lg p-3 space-y-1">
                  <h4 className="text-xs font-bold text-red-700">📊 ROI Statistics</h4>
                  {Object.entries(roiStats).map(([k,v])=>(
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-600 capitalize">{k}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Measurements list */}
              {measurements.length>0 && (
                <div className="bg-green-50 rounded-lg p-3">
                  <h4 className="text-xs font-bold text-green-700 mb-1">Measurements</h4>
                  {measurements.map((m,i)=>(
                    <div key={i} className="text-xs text-green-600">#{i+1}: {m.distance} px</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* INFO */}
          {toolTab==='info' && metadata && (
            <div className="card space-y-1">
              <h3 className="font-bold text-sm">📋 DICOM Metadata</h3>
              {Object.entries(metadata).map(([k,v])=>(
                <div key={k} className="flex justify-between text-xs py-0.5">
                  <span className="text-gray-500">{k}</span>
                  <span className="font-medium text-right max-w-[55%] truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ RIGHT PANEL: IMAGE VIEWER ═══ */}
        <div className="md:col-span-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Active:</span>
            <span className="badge bg-blue-100 text-blue-700">{activeFilter==='none'?'Original':activeFilter}</span>
            {windowPreset!=='default' && <span className="badge bg-purple-100 text-purple-700">Window: {windowPreset}</span>}
            {measuring   && <span className="badge bg-green-100 text-green-700">📏 Measuring</span>}
            {drawingROI  && <span className="badge bg-red-100 text-red-700">{isDraggingROI?'▢ Drawing…':'▢ ROI Mode'}</span>}
            {annotating  && <span className="badge bg-yellow-100 text-yellow-700">📝 Annotating</span>}
          </div>

          <div ref={containerRef} className="card p-2">
            <div
              className="bg-black rounded-lg overflow-hidden flex items-center justify-center relative"
              style={{ minHeight:'450px', cursor: canvasCursor }}
            >
              <div style={{
                transform:`scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH?-1:1}) scaleY(${flipV?-1:1})`,
                filter:`brightness(${brightness}%) contrast(${contrast}%) ${invert?'invert(1)':''}`,
                transition:'transform 0.2s, filter 0.2s',
                position:'relative',
                userSelect:'none',
              }}>
                {/* Main image canvas */}
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}   /* finalize if pointer leaves canvas */
                  style={{ maxWidth:'100%', maxHeight:'500px', objectFit:'contain', display:'block' }}
                />
                {/* Overlay canvas — pointer events disabled so main canvas receives events */}
                <canvas
                  ref={overlayCanvasRef}
                  style={{ position:'absolute', top:0, left:0, maxWidth:'100%', maxHeight:'500px', pointerEvents:'none' }}
                />
              </div>
            </div>
          </div>

          {/* Histogram */}
          {showHistogram && histData && (
            <div className="card">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-sm">📊 Histogram</h3>
                <button onClick={()=>setShowHistogram(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {['gray','r','g','b'].map(ch=>{
                  const colors={gray:'#666',r:'#ef4444',g:'#22c55e',b:'#3b82f6'};
                  const labels={gray:'Grayscale',r:'Red',g:'Green',b:'Blue'};
                  const maxVal=Math.max(...histData[ch]);
                  return (
                    <div key={ch}>
                      <p className="text-xs font-medium mb-1" style={{color:colors[ch]}}>{labels[ch]}</p>
                      <div className="flex items-end h-16 gap-px bg-gray-50 rounded p-1">
                        {histData[ch].filter((_,i)=>i%4===0).map((val,i)=>(
                          <div key={i} style={{height:`${(val/maxVal)*100}%`,backgroundColor:colors[ch],flex:1,minWidth:'1px',opacity:0.7}} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {findings && (
        <div className="card border-l-4 border-blue-500">
          <h3 className="font-bold mb-1">📝 Pathologist Findings</h3>
          <p className="text-gray-700">{findings}</p>
        </div>
      )}
    </div>
  );
}
