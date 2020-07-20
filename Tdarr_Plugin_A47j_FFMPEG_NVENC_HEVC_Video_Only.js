function details() {
  return {
    id: "Tdarr_Plugin_A47j_FFMPEG_NVENC_HEVC_Video_Only",
    Name: "FFMPEG nvenc_H265 Video Only",
    Type: "Video",
    Stage: "Pre-processing",
    Operation: "Transcode",
    Description: `[Contains built-in filter] This plugin transcodes non-h265 files into h265 mkv, reducing resolution to 1920x1080 using nvenc. Audio/subtitles not affected. Bitrate is scaled based on input file. \n\n`,
    Version: "1.00",
    Tags: "pre-processing,video only,ffmpeg,nvenc h265",

  };
};

// How much does HVEC compress the raw stream?
var compressionFactor = 0.07;

var MediaInfo = {
  videoHeight: "",
  videoWidth: "",
  videoFPS:"",
  videoBR: "",
  videoBitDepth: "",
  overallBR: "",
  JSRProcessed: false,
  JSRVersion: 0,
  JSRProcessedTime: 0,
}; // var MediaInfo

// Easier for our functions if response has global scope.
var response = {
    processFile: false,
    preset: "",
    container: ".mkv",
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: "",
}; // var response

// Runs mkvpropedit --add-track-statistics on the file.
function updateTrackStats(file) {
  response.infoLog += `☑Running mkvpropedit.\n`;
  try {
    const proc = require("child_process");
    proc.execFile('mkvpropedit', [ '--add-track-statistics-tags', file._id], (error,stdout,stderr) => {
      if (error) throw `mkvpropedit failed: ${error}\n`;
    });
  } catch (err) {
    response.infoLog += `mkvpropedit failed: ${err}.\n`;
    throw `mkvpropedit failed: ${err}.\n`;
  };  // end try/catch

  return 0;
}  // end updateTrackStats()

// Runs mediainfo on the file, gets JSON output, finds the first video stream and returns the video bit rate and bit depth.
function getMediaInfo(file) {
  var objMedInfo = "";

  response.infoLog += `☑Running mediainfo.\n`;

  try {
    const proc = require('child_process')
    objMedInfo = JSON.parse(proc.execFileSync('mediainfo', [file._id,'--output=JSON']));
  } catch (err) {
    response.infoLog += `Mediainfo failed: ${err}.\n`;
    throw `Mediainfo failed: ${err}.\n`;
  }; // end try/catch

  var videoIdx = -1;
  var videoInxFirst = -1;

  for (var i = 0; i < file.ffProbeData.streams.length; i++) {

      strstreamType = file.ffProbeData.streams[i].codec_type.toLowerCase();

      //Looking For Video
      // Check if stream is a video.
      if (videoIdx == -1 && strstreamType == "video") {
          videoIdx = i;
          videoInxFirst = i;

          MediaInfo.videoHeight = Number(file.ffProbeData.streams[i].height);
          MediaInfo.videoWidth = Number(file.ffProbeData.streams[i].width);
          MediaInfo.videoFPS = Number(objMedInfo.media.track[i + 1].FrameRate);
          MediaInfo.videoBR = Number(objMedInfo.media.track[i + 1].BitRate);
          MediaInfo.videoBitDepth = Number(objMedInfo.media.track[i + 1].BitDepth);   
      }
  }
     MediaInfo.overallBR = objMedInfo.media.track[0].OverallBitRate;
     
     try {
       MediaInfo.JSRVersion = Number(objMedInfo.media.track[0].extra.JSRVERSION);
     } catch (err) {
       MediaInfo.JSRVersion = "";
     }

     try {
       MediaInfo.JSRProcessed = Boolean(objMedInfo.media.track[0].extra.JSRPROCESSED);
     } catch (err) {
       MediaInfo.JSRProcessed = "";
     }

     try {
       MediaInfo.JSRProcessedTime = Number(objMedInfo.media.track[0].extra.JSRPROCESSEDTIME);
     } catch (err) {
       MediaInfo.JSRProcessedTime = "";
     }

  return;
} // end  getMediaInfo()

function plugin(file,librarySettings,inputs,otherArguments) {
  //Must return this object

  if (file.fileMedium !== "video") {
    response.processFile = false;
    response.infoLog += "☒File is not a video.\n";
    return response;
  };


//response.infoLog += "File: " + JSON.stringify(file, null, 4) + "\n";
//response.infoLog += `mtime = ${file.statSync.mtimeMs}\n`

//     --------------------------------  METADATA UPDATES   --------------------------------
  // If there is no _STATISTICS_WRITING_DATE_UTC-eng field, then we need to run mkvpropedit and
  //  rerun mediainfo to load the stats.
  if (file.ffProbeData.streams[0].tags["_STATISTICS_WRITING_DATE_UTC-eng"] == undefined ) {
    response.infoLog += "☑Track statistics are missing.\n";
    updateTrackStats(file);
    getMediaInfo(file);
  } else {
    // mkvpropedit records the time the stats were written.  Get it (specify it is in UTC) and add a 10 second buffer.
    StatsWritingTime = Date.parse(`${file.ffProbeData.streams[0].tags["_STATISTICS_WRITING_DATE_UTC-eng"]} UTC`) + 10000;

    // If the file's mtime is more than 60 seconds later than  StatsWritingTime, then we should rerun mkvpropedit!
    if ( file.statSync.mtimeMs > StatsWritingTime ) {
      response.infoLog += "☑Track statistics are out of date.\n";
      updateTrackStats(file);
      getMediaInfo(file);
    } else {
      response.infoLog += "☑Track statistics are up to date.\n";
      getMediaInfo(file);
    }
  }

  if ( isNaN(MediaInfo.videoBR) || isNaN(MediaInfo.videoBitDepth) ) {
	response.infoLog += "videoBR or videoBitDepth was NaN, something went wrong with mediainfo.\n";
    updateTrackStats(file);
    getMediaInfo(file);
    if ( isNaN(MediaInfo.videoBR) || isNaN(MediaInfo.videoBitDepth) ) {
      response.infoLog += "videoBR or videoBitDepth still NaN, giving up.\n";
      throw ("MediaInfo.videoBR or videoBitDepth still NaN, giving up.");
    }
  }

  // If the overall bitrate is less than the videoBR, then something is wacky.
  if ( MediaInfo.videoBR > MediaInfo.overallBR ) {
	  response.infoLog += `videoBR (${MediaInfo.videoBR} was greater than overallBR (${MediaInfo.overallBR}), which is impossible. Updating stats.\n`;
    updateTrackStats(file);
    getMediaInfo(file);
    if ( MediaInfo.videoBR > MediaInfo.overallBR ) {
	    response.infoLog += `videoBR and overallBR still inconsistent, giving up.\n`;
      throw (`videoBR (${MediaInfo.videoBR}) and overallBR (${MediaInfo.overallBR}) still inconsistent, giving up.`);
    }
  };



  if ( (MediaInfo.JSRProcessed != undefined && MediaInfo.JSRProcessed == true) || file.forceProcessing === true) {
    response.infoLog += `JSRPROCESSED metadata tag was true.  This file was already transcoded by this plugin.  Exiting...\n`;
    response.processFile = false;
    return response  
  };

var bitrates = {
  "480p": {
    min:       698000,
  },
  "576p": {
    min:      930000,
  },
  "720p": {
    min:      1396000
  },
  "1440p": {
    min:       2792000
  },
  "2160p": {
    min:       2792000
  },
  "4KUHD": {
    min:       2792000
  },
  "1080p": {
    min:       2792000
  },
}; // var bitrates
//case "DCI54K"
//case "8KUHD"

  // Set decoding options here
  switch (file.ffProbeData.streams[0].codec_name) {
    case "hevc":
      response.preset = `-vsync 0 -hwaccel cuda -hwaccel_output_format cuda -c:v hevc_cuvid  `;
    break;
    case "h264":
      response.preset = `-vsync 0 -hwaccel cuda -hwaccel_output_format cuda -c:v h264_cuvid `;
    break;
    case "vc1":
      response.preset = `-vsync 0 -hwaccel cuda -hwaccel_output_format cuda -c:v vc1_cuvid `;
	break;
	case "vp8":
      response.preset = `-vsync 0 -hwaccel cuda -hwaccel_output_format cuda -c:v vp8_cuvid `;
	break;
	case "vp9":
      response.preset = `-vsync 0 -hwaccel cuda -hwaccel_output_format cuda -c:v vp9_cuvid `;
    break;
  }; //end switch(codec)

// Resize high resolution videos to 1080p.
switch (file.video_resolution) {
  case "DCI54K":
  case "8KUHD":
  case "4KUHD":
  case "2160p":
  case "1440p":
    response.preset += ` -resize 1920x1080 `;
    response.infoLog += `Resizing to 1080p.\n`;
    response.processFile = true;
    var targetBitrate = Math.round(1920*1080*MediaInfo.videoFPS*MediaInfo.videoBitDepth/8)*compressionFactor;
    break;
  default:
    var targetBitrate = Math.round(MediaInfo.videoWidth*MediaInfo.videoHeight*MediaInfo.videoFPS*MediaInfo.videoBitDepth/8)*compressionFactor;
    break;
}; // end switch(resolution)

// Calculate bitrates
response.infoLog += `Video details: ${file.ffProbeData.streams[0].codec_name}-${file.video_resolution} ${MediaInfo.videoWidth}x${MediaInfo.videoHeight}x${MediaInfo.videoFPS}@${MediaInfo.videoBitDepth}.\n`

var maxBitrate = Math.round(targetBitrate*1.3);
var minBitrate = Math.round(targetBitrate*0.7);
var bufsize = Math.round(MediaInfo.videoBR);


if ( MediaInfo.videoBitDepth >= 10 ) {
  response.preset += `,-map 0:v -map 0:a -map 0:s? -map -:d? -c copy -c:v:0 hevc_nvenc -rc:v vbr_hq -preset medium -profile:v main10 -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 8 -max_muxing_queue_size 4096 `;
} else {
  // 8 bit encoding
  response.preset += `,-map 0:v -map 0:a -map 0:s? -map -:d? -c copy -c:v:0 hevc_nvenc -rc:v vbr_hq -preset medium -profile:v main10 -rc-lookahead 32 -spatial_aq:v 1 -aq-strength:v 8 -max_muxing_queue_size 4096 `;
}; //endif BitDepth

response.infoLog += `Video bitrate is ${Math.round(MediaInfo.videoBR/1000)}Kbps, overall is ${Math.round(MediaInfo.overallBR/1000)}Kbps. `;
response.infoLog += `Calculated target is ${Math.round(targetBitrate/1000)}Kbps.\n`;


  // Adjust target bitrates by codec and bitrate
  switch (file.ffProbeData.streams[0].codec_name) {
    case "hevc":
      if ( (MediaInfo.videoBR > targetBitrate*2) || file.forceProcessing === true )  {
        response.processFile = true;
        response.preset +=` -b:v ${targetBitrate} -maxrate ${maxBitrate} -minrate ${minBitrate} -bufsize ${bufsize} `;
        response.infoLog += `☒HEVC Bitrate for ${file.video_resolution} exceeds ${targetBitrate*2/1000}Kbps, downsampling to ${targetBitrate/1000}Kbps.\n`;
      } else {
        response.infoLog += `☑HEVC Bitrate is within limits.\n`
      };
    break; // case "hevc"
    case "h264":
      response.processFile = true;
      // We want the new bitrate to be 70% the h264 bitrate, but not higher than our target.
      new_bitrate = Math.min(Math.round(MediaInfo.videoBR*0.7),targetBitrate);
      // New bitrate should not be lower than our 60% of our target.
      new_bitrate = Math.max( new_bitrate, Math.min(MediaInfo.videoBR, targetBitrate*0.6) );
      response.preset +=` -b:v ${new_bitrate} -maxrate ${Math.round(new_bitrate*1.3)} -minrate ${Math.round(new_bitrate*0.7)} -bufsize ${bufsize}`;
      response.infoLog += `☒H264 Resolution is ${file.video_resolution}, bitrate was ${Math.round(MediaInfo.videoBR/1000)}Kbps.  HEVC target bitrate will be ${Math.round(new_bitrate/1000)}Kbps.\n`;
    break; // case "h264"
    default:
      response.processFile = true;
      response.preset +=` -b:v ${targetBitrate} -maxrate ${maxBitrate} -minrate ${minBitrate}K -bufsize ${bufsize} `;
      response.infoLog += `☒${file.ffProbeData.streams[0].codec_name} resolution is ${file.video_resolution}, bitrate was ${Math.round(MediaInfo.videoBR/1000)}Kbps.  HEVC target bitrate will be ${Math.round(new_bitrate/1000)}Kbps.\n`;
    break; // default
  } // switch (file.ffProbeData.streams[0].codec_name)


  

  if (response.processFile == true) {
    response.preset += ` -map_metadata:g -1 -metadata JSRVERSION=1 -metadata JSRPROCESSED=true -metadata JSRPROCESSEDTIME=${Date.now()} `;
    response.FFmpegMode = true;
    response.infoLog += `☒Transcoding to HEVC.`;
  } else {
    if (file.container != "mkv") {
      response_preset = ',-c copy -map 0';
      response.processFile = true;
      response.infoLog += `☒Remuxing to mkv.`;
    }
  }
 return response;
} // end plugin()

module.exports.details = details;
module.exports.plugin = plugin;
