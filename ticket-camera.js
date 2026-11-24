/* On-device, transient camera frames. No photos are persisted or uploaded. */
function cameraFrameStats(pixels, previous) {
  let light=0,motion=0,edges=0;const gray=[];
  for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;gray.push(v);light+=v;if(previous)motion+=Math.abs(v-previous[i/4]);if(i>=4)edges+=Math.abs(v-gray[gray.length-2]);}
  return {gray,light:light/gray.length,motion:previous?motion/gray.length:0,edges:edges/gray.length};
}
function installTicketCamera({scan,loadScanner,isBusy}) {
  const el=id=>document.getElementById(id),dialog=el('ticket-camera-dialog'),video=el('live-ticket-video');
  let stream=null,worker=null,timer=null,session=0,checking=false,previous=null,oldOverflow='',ocrAt=0,readyUntil=0;
  function message(text,ready=false){el('live-camera-status').textContent=text;el('live-camera-status').classList.toggle('ready',ready);}
  function close(){session++;clearTimeout(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;if(worker){worker.terminate().catch(()=>{});worker=null;}checking=false;previous=null;readyUntil=0;if(dialog.open)dialog.close();document.body.style.overflow=oldOverflow;if(document.fullscreenElement===dialog)document.exitFullscreen().catch(()=>{});}
  function frame(maxWidth){const canvas=document.createElement('canvas');const scale=Math.min(1,maxWidth/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return canvas;}
  async function check(id){
    if(id!==session||!stream)return;
    try{
      if(video.readyState<2)return;
      const tiny=frame(128),stats=cameraFrameStats(tiny.getContext('2d').getImageData(0,0,tiny.width,tiny.height).data,previous);previous=stats.gray;
      if(stats.light<45){readyUntil=0;message('Too dark — add light without glare.');}
      else if(stats.motion>13){readyUntil=0;message('Hold steady — keep the ticket and phone still.');}
      else if(!checking&&worker&&Date.now()-ocrAt>3500){
        checking=true;ocrAt=Date.now();const image=frame(1280);message('Checking the game, DRAW date and number rows…');
        const result=await worker.recognize(image);if(id!==session)return;
        const meta=parseTicketMetadata(result.data.text),quality=assessScanQuality(result.data.text,result.data.confidence,Number(meta.game),result.data.words||[]);
        if(quality.clear){readyUntil=Date.now()+4500;message('Ready to capture — detected details look readable.',true);}
        else {readyUntil=0;message(!parseLabelledPicks(result.data.text).length?'Numbers not clear — move closer, keep every row visible, and hold steady.':!meta.game?'Include the game at the top of the ticket.':!meta.date?'Include the complete DRAW date line.':'Some numbers need a clearer view — adjust distance and avoid glare.');}
        checking=false;
      }else if(readyUntil&&Date.now()>readyUntil){readyUntil=0;message('Hold steady — checking again shortly.');}
    }catch{if(id===session){checking=false;message('Live reading unavailable. You can capture now and review the photo.');}}
    finally{if(id===session)timer=setTimeout(()=>check(id),650);}
  }
  async function open(){
    if(isBusy())return;
    if(!navigator.mediaDevices?.getUserMedia){el('scan-take-file').click();return;}
    oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
    if(dialog.requestFullscreen)dialog.requestFullscreen().catch(()=>{});
    el('live-native').hidden=true;const id=++session;el('live-capture').disabled=true;message('Opening your rear camera…');
    try{
      const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1440}}});
      if(id!==session){next.getTracks().forEach(t=>t.stop());return;}stream=next;video.srcObject=stream;await video.play();if(id!==session)return;el('live-capture').disabled=false;
      const track=stream.getVideoTracks()[0],caps=track.getCapabilities?.()||{};
      if(caps.focusMode?.includes('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
      message('Fit the game, all picks and DRAW date in the guide. Loading live check…');
      const engine=await loadScanner();if(id!==session)return;const nextWorker=await engine.createWorker('eng');if(id!==session){await nextWorker.terminate();return;}worker=nextWorker;ocrAt=0;check(id);
    }catch(error){if(id!==session)return;if(!stream)el('live-native').hidden=false;message(stream?'Live reading could not load. Capture and review your photo, or check your connection.':'Camera unavailable. Allow camera access, or choose Use phone camera / Upload Photo.');}
  }
  el('live-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  el('live-native').onclick=()=>{close();el('scan-take-file').click();};
  el('live-capture').onclick=()=>{if(!video.videoWidth)return;el('live-capture').disabled=true;const image=frame(2400),id=session;image.toBlob(blob=>{if(id!==session)return;close();if(blob)scan(new File([blob],'ticket.jpg',{type:'image/jpeg'}));else el('scan-status').textContent='Could not capture. Please retake the photo.';},'image/jpeg',.95);};
  video.onclick=async event=>{const track=stream?.getVideoTracks()[0],caps=track?.getCapabilities?.()||{};if(!track)return;const setting={};if(caps.focusMode?.includes('single-shot'))setting.focusMode='single-shot';else if(caps.focusMode?.includes('continuous'))setting.focusMode='continuous';const rect=video.getBoundingClientRect();if('pointsOfInterest' in caps)setting.pointsOfInterest=[{x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height}];if(Object.keys(setting).length)try{await track.applyConstraints({advanced:[setting]});}catch{};};
  window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open)close();});
  el('scan-take').onclick=open;
}
