var fs =                require('fs');
var stprCal =           require('./stepperCalibration.json');
var events =            require('events');
var rpio =              require('rpio');
var CronJob =           require('cron').CronJob;
var cp =                require('child_process');
var sunCalc =           require('suncalc');
var package =           require('./package.json')

var stepper =           require('rg-stepper');
var alphnmrc =          require('rg-alphanumeric');
var ledStrip =          require('rg-ledstrip');
var wxDta =             require('wugdatafetcher');

const MyCfg =   require("./thisAppsCfgManager.js")


var myCfg = new MyCfg(__dirname + '/thisAppsCfgMaster.json', __dirname + '/thisAppsCfg.json');

myCfg.on('Update', ()=>{
    console.log("Config has been updated!  Reloading....");
    reloadConfigFile();
})

// class and object setup
const I2cAddress = {bankCnt:4, alphNum1:0x70, alphNum2:0x71, alphNum3:0x72, alphNum4:0x73 };
const alphNumA = new alphnmrc(I2cAddress, 1000);
console.log('Alphanumeric setup!');
alphNumA.prnStrCntrd8('BOOTING'); 

const ledPins = {ledData:11, ledClk:7}
const ledCount = 24;
const ledStA = new ledStrip(ledPins, ledCount);
console.log('LED strip setup!');
ledStA.sparkleAsync(20, 0, 0 ,255, -1, function(){});

const mtrAPins = {"AIN1":26, "AIN2":23, "BIN1":29, "BIN2":32}; 
const mtrA = new stepper(mtrAPins, stprCal.wg_temperature)
console.log('stepper setup! Move to position 25');
mtrA.setValue(25);

console.log('Setting up weather underground data class');
console.log('API Key = ' + myCfg.config.wuAPIKey +', Station ID = ' + myCfg.config.wuPws + ', Interval = '+ myCfg.config.apiMaxCallDelay);

const wxData = new wxDta(myCfg.config.wuAPIKey, myCfg.config.wuPws, myCfg.config.apiMaxCallDelay);
wxData.eventNewData(cb_newWxData);                          // set function to call back when new data is received
wxData.eventDataRequest(cb_startingWxDataFetch);            // set function to call back when a request for new data starts
wxData.eventGetDataErr(cb_wxDataFetchError);                // set function to call back when an error occurs getting data
wxData.getRainHistory();

// Global Vars
var apiCallRate = myCfg.config.apiMaxCallDelay;            // Time in seconds of normal poll interveral
var apiCallCount = 0;
var dfaltViewNum = Number(myCfg.config.dfaltViewNum);
var firstRun = 1;
var BTN1pin = 15;                                           // (Button connected to this pin and ground)
var LED1pin = 13;                                           // (LED connected to 240 ohm resistor)
var Buzzerpin = 31;                                         // Pin connected Pizeo buzzer
var sunriseTime;
var sunsetTime;
var cronHourlyReport = null;
var cronBrightStart = null;
var cronBrightEnd = null;
var cronQuietTimeStart = null;
var cronQuietTimeEnd = null;
var alphaNumBrightnessLast;                                 // Global to hold last brightness setting sent to AlphaNumeric
var alphaNumOnLast = true;
var faceLightBrightnessLast;                                // Global to hold last brightness setting for LED Ring (face light)
var faceLightOnLast = true;
var dataFetchStartTime = new Date();
var lastDataFetchStartTime = new Date();

updateSunsetSunrise();

console.log('__dirname = ' + __dirname);
console.log('__filename' + __filename);

console.log("Setting up LED outputs on pin " + LED1pin);
rpio.open(LED1pin, rpio.OUTPUT, rpio.LOW);

console.log("Setting up Buzzer on pin " + Buzzerpin);
rpio.open(Buzzerpin, rpio.OUTPUT, rpio.LOW);

console.log("Setting button input on pin has been disabled " + BTN1pin);
//rpio.open(BTN1pin, rpio.INPUT, rpio.PULL_UP);        // setup pin for input use internal pull up resistor
//rpio.poll(BTN1pin, pollcb1);
//LED1setOnOff(1);

alphNumA.setBright(Number(myCfg.config.alphaNumBright));
alphaNumBrightnessLast = myCfg.config.alphaNumBright;

//console.log('Setting speaker volume to ' + soundVolume + '%' );
//setVolume(soundVolume);

ledStA.setAll(10,255,255,255);

var countDownSeconds = 61;
mtrA.setValue(60);
var countDownTimer = setInterval(function(){countDownToFirstUpload()}, 1000);    //IPL complete after this counter 

var crondailyMaintenance = new CronJob('0 55 2 * * *', ()=>{dailyMaintenance()}, null, true);     // Every day at 2:55am get river flow data.
var resetdailCounters = new CronJob('0 0 0 * * *', ()=>{apiCallCount = 0;}, null, true);          // Every day at midnight.


/* Presentation ------------------------------------------------------------------------------------------------------------------------------*/
function showData(viewNum){                 // set the display face to various scens based on view numbers
    var dateTime = new Date();
    var rainSum = 0
    rainSum = lastRainEventTotal(wxData.wxObj.history.rainDaysOld);
    console.log('rainSum = ' + rainSum);
    console.log ('showLvl called at ' + dateTime.toTimeString());

   setFaceColor([31,255,108,23])
    if (firstRun == 1){
        alphNumA.tickerPrint8('NAME = ' + wxData.wxObj.location_txt.toString().toUpperCase() + ' ID = ' + wxData.wxObj.station_id, 150);
        firstRun = 0;
    }

    switch(viewNum){            
        case 0:     // Rain event
            mtrA.setValueAsync(wxData.wxObj.feelslike_f, function(){});
            if(_alphanumeric()){
                alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.temp_f + 'F'), 1);    
                alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.wind_mph), 2);      
                if (wxData.wxObj.precip_today_in > 0 || rainSum > 0){                           
                    alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.precip_today_in + String.fromCharCode(19)), 3); 
                    var eventSum = (Number(wxData.wxObj.precip_today_in) + Number(rainSum)).toFixed(2);
                    alphNumA.prnStrToBank(ctr4CharStr(eventSum + String.fromCharCode(19)), 4);                           
                } else {
                    alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.relative_humidity), 3); 
                    alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.wind_degrees), 4);
                }
            } 
            break;      

        case 1:     // Rain today only, no rain event history
            mtrA.setValueAsync(wxData.wxObj.feelslike_f, function(){});
            if(_alphanumeric()){
                alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.temp_f + 'F'), 1);    
                alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.wind_mph), 2);      
                if (wxData.wxObj.precip_today_in > 0){                           
                    alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.precip_today_in + String.fromCharCode(19)), 3);                         
                } else {
                    alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.relative_humidity), 3); 
                }
                alphNumA.prnStrToBank(ctr4CharStr(wxData.wxObj.wind_degrees), 4);
            } 
            break;                               
         
        default:
            alphNumA.tickerPrint8('ERROR NO CASE MATCH', 250);
            console.warn("no case match for showRvrLvl. " + viewNum);
            break;                                
    }       
}

/* Data --------------------------------------------------------------------------------------------------------------------------------------*/
function cb_startingWxDataFetch(dateObj){   // called when wxData makes request for new data. 
    var timeIt = new Date(dateObj);  
    dataFetchStartTime = timeIt 
    //console.log('\nGetting Weather Data...');
    //LED1setOnOff(1);         // turn LED in button on
    if(_faceLight() && _animation()){
        ledStA.walkPatternAsync([[31,255,108,23],[31,255,108,23],[31,255,108,23]], 0, 10, 50, function(errNumber, errTxt, value){
            if(errNumber == 0){
                ledStA.walkPatternAsync([[31,255,108,23],[31,255,108,23],[31,255,108,23]], 0, 50, 0, function(){});
            } 
        });  
    }    
}

function cb_newWxData(){                    // called wxData receives new weather data.
    apiCallCount++;
    var timeIt = new Date();
    var callTime = timeIt - dataFetchStartTime;
    var secondsBetweenCalls = dataFetchStartTime - lastDataFetchStartTime;
    lastDataFetchStartTime = dataFetchStartTime;
    console.log(' New WX Data: call count = '+ apiCallCount +', RTT = '+ callTime +' milliseconds, call interval = ' + secondsBetweenCalls.valueOf() / 1000 +', goal = '+ apiCallRate);
    ledStA.killIfBusy();    
    sendStatusToMyCfg();
    showData(dfaltViewNum)           
}

function cb_wxDataFetchError(errNum, errTxt){   // called if wxData fetch is in error
    //LED1setOnOff(0);
    ledStA.killIfBusy();
    ledStA.setAll(5,255,0,0);

    console.log('\nERROR:\tError getting data from Weather Underground API');
    console.log('\tError Number = ' + errNum);
    console.log('\t'+ errTxt + '\n');

    sendStatusToMyCfg('There was an error getting forecast data. Make sure your weather underground API key and station ID are correct, error number: ' + errNum +', '+ errTxt, 'danger', 'ERROR Getting WX Data <hr>');  
}

/* Utilities   -------------------------------------------------------------------------------------------------------------------------------*/
function setFaceColor(faceColorToSet){      // Sets LED ring color based on color array 
    if(_faceLight()){
        var bright = faceLightBrightnessLast;
        var r = faceColorToSet[1];
        var g = faceColorToSet[2];
        var b = faceColorToSet[3];
        ledStA.setAll(bright, r, g, b);
        //console.log('setFaceColor setall = '+bright+", "+r+", "+g+","+b);
    }
} 

function lastRainEventTotal(arrayDlyAmt){   // Sums array until first 0 value is found. Returns sum
    console.log('*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/')
    console.log('\t\t*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/')    
    console.log('lastRainEventTotal called with');
    console.dir(arrayDlyAmt, {depth:null});
    console.log('\t\t*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/')  


    if(Number(arrayDlyAmt[1]) == 0){return 0};
    var eventTotal = 0;
    for (var index = 1; index < arrayDlyAmt.length; index++) {
        if(Number(arrayDlyAmt[index]) == 0){
            return eventTotal;
        } else {
            eventTotal += Number(arrayDlyAmt[index])
        }
    }
    return eventTotal;
}

function ctr4CharStr(strToCenter){          // centers a 4 charcter string by adding spaces
    var stc = strToCenter.toString();
    if(stc.length >= 4){
        return(stc);
    } else if (stc.length >= 2){
        return(" " + stc);
    } else if (stc.length == 1){
        return("  " + stc);
    } else {
        return(stc);
    }
}

function getPrimetimeEvtLoopInterval(){     // Calculates primetime delay interval to stay in budget based on apiMaxCallDealy in rGaugeConfig.json
    var quietStart = new Date(myCfg.config.quietTimeStart);   
    var quietEnd =   new Date(myCfg.config.quietTimeEnd);
    var fpEndDec = quietEnd.getHours() + quietEnd.getMinutes() / 60;
    var fpStartDec = quietStart.getHours() + quietStart.getMinutes() / 60;     
    var fpHours = 0;     

    if(quietEnd.toTimeString() < quietStart.toTimeString()){    // Spans Midnight
        fpHours = (24 - fpStartDec) + fpEndDec;
    } else {
        fpHours = fpEndDec - fpStartDec;
    }    
    return wxData.getMaxPollRate(myCfg.config.apiMaxCallDelay, fpHours * 3600, myCfg.config.apiCallsPerDay);
}

function changeWxDataPollInterval(intvrl){  // Changes wxData poll rate
    console.log('wxData poll time changed to ' + intvrl + ' seconds delay.');
    apiCallRate = intvrl;
    wxData.setWxPollTime(intvrl);        
}

function countDownToFirstUpload(){          // Used during IPL to display count down allowing network connections to be established 
    countDownSeconds--;
    //console.log("countdown = " + countDownSeconds);
    alphNumA.prnStrCntrd8('VER ' + package.version);  
    alphNumA.prnStrToBank('WAIT', 3);
    alphNumA.prnStrToBank(countDownSeconds, 4);  
    mtrA.setValue(countDownSeconds);
    if (countDownSeconds <= 0 ){
        clearInterval(countDownTimer);      // stop timmer

        sendStatusToMyCfg('Gauge powerup complete. Getting gauge data from Internet please wait...');
        iplActive = false;
        _alphanumeric();
        _faceLight();
        console.log("Reached end of countdown");
        startCronJobs();
        wxData.updateNow();
        if(inQuietMode()){console.log('slow poll rate = ' + apiCallRate);} else {console.log('fast poll rate = ' + apiCallRate);}

    }
} 

function dailyMaintenance(){                // runs every morning to refresh items like the cron job's sunrise and sunset values 
    var rightNow = new Date();
    console.log('--------------------------------------------------------------');
    console.log('----> Daily maintenance fired at: ' + rightNow.toTimeString());
    console.log('--------------------------------------------------------------');    
    updateSunsetSunrise();
    startCronJobs();   
    wxData.updateNow();
    wxData.getRainHistory();
}

function startCronJobs(){                   // start and stop cron jobs as their configuration changes
    if(cronHourlyReport){cronHourlyReport.stop();}
    if(cronBrightStart){cronBrightStart.stop();}
    if(cronBrightEnd){cronBrightEnd.stop();}    
    if(cronQuietTimeStart){cronQuietTimeStart.stop();}
    if(cronQuietTimeEnd){cronQuietTimeEnd.stop();}     

    //Start Hourly reports
    //cronHourlyReport = new CronJob('0 0 * * * *', function(){hourleyAlertReport();}, null, true);                // Every Hour run hourly report.    

    //Schedule cron for change to Bright Display mode    
    var timeToFire = new Date(myCfg.config.displayBrightStart);
    if(myCfg.config.displayBrightStartAtSunrise == 'true'){
        timeToFire = sunriseTime;
    }
    var h = timeToFire.getHours();
    var m = timeToFire.getMinutes();
    console.log('cronBrightStart started with (0 '+m+' '+h+' * * *) ');
    cronBrightStart = new CronJob('0 '+m+' '+h+' * * *', function(){
        var rightNow = new Date();
        console.log('--------------------------------------------------------------');
        console.log('----> cronBrightStart fired at: ' + rightNow.toTimeString());
        console.log('--------------------------------------------------------------');
        sendStatusToMyCfg();         
        showData(dfaltViewNum); 
    }, null, true);

    //Schedule cron for change to Dim Display mode
    timeToFire = new Date(myCfg.config.displayBrightEnd);
    if(myCfg.config.displayBrightEndAtSunset == 'true'){
        timeToFire = sunsetTime;
    }
    h = timeToFire.getHours();
    m = timeToFire.getMinutes();
    console.log('cronBrightEnd started with (0 '+m+' '+h+' * * *) ');
    cronBrightEnd = new CronJob('0 '+m+' '+h+' * * *', function(){
        var rightNow = new Date();
        console.log('--------------------------------------------------------------');
        console.log('----> cronBrightEnd fired at: ' + rightNow.toTimeString());
        console.log('--------------------------------------------------------------');         
        sendStatusToMyCfg(); 
        showData(dfaltViewNum);
    }, null, true);

    //Schedule cron to trigger quiet time start
    timeToFire = new Date(myCfg.config.quietTimeStart);
    h = timeToFire.getHours();
    m = timeToFire.getMinutes();
    console.log('cronQuietTimeStart started with (0 '+m+' '+h+' * * *) ');
    cronQuietTimeStart = new CronJob('0 '+m+' '+h+' * * *', function(){
        var rightNow = new Date();
        console.log('--------------------------------------------------------------');
        console.log('----> cronQuietTimeStart fired at: ' + rightNow.toTimeString());
        console.log('--------------------------------------------------------------');  
        sendStatusToMyCfg();        
        showData(dfaltViewNum);
    }, null, true);

    //Schedule cron to trigger quiet time end
    timeToFire = new Date(myCfg.config.quietTimeEnd);
    h = timeToFire.getHours();
    m = timeToFire.getMinutes();
    console.log('cronQuietTimeEnd started with (0 '+m+' '+h+' * * *) ');
    cronQuietTimeEnd = new CronJob('0 '+m+' '+h+' * * *', function(){
        var rightNow = new Date();
        console.log('--------------------------------------------------------------');
        console.log('----> cronQuietTimeEnd fired at: ' + rightNow.toTimeString());
        console.log('--------------------------------------------------------------');         
        sendStatusToMyCfg(); 
        showData(dfaltViewNum);
    }, null, true);
}

function _alphanumeric(){                   // Returns true if it is okay to send text to alphanumeric also sets brightness and on/off
    if(myCfg.config.gaugeDisplayEnable=="false"  || (inQuietMode()==true && myCfg.config.qtGaugeDisplayEnable=="false")){
        if(alphaNumOnLast == true){
            console.log('_alphanumeric() turning off Alphanumeric Display');
            alphNumA.displayOn(false);
            alphaNumOnLast = false;
        }
        return(false); // AlphaNumeric is disabled, make sure it is off and retrun false
    } else {
        if(alphaNumOnLast == false){
            console.log('_alphanumeric() turning on Alphanumeric Display');
            alphNumA.displayOn(true);
            alphaNumOnLast = true;
        }
    }
    // if logic makes it to this point it is okay to be on, need to determine brightness:
    if(inNightMode()){
        if(alphaNumBrightnessLast != myCfg.config.alphaNumDim){
            alphNumA.setBright(Number(myCfg.config.alphaNumDim));
            alphaNumBrightnessLast = myCfg.config.alphaNumDim;
        }
    } else {
        if(alphaNumBrightnessLast != myCfg.config.alphaNumBright){
            alphNumA.setBright(Number(myCfg.config.alphaNumBright));
            alphaNumBrightnessLast = myCfg.config.alphaNumBright;
        }        
    }
    return true;
}

function _animation(){                      // Returns true if it is okay to play animation
    if(inQuietMode()==true && myCfg.config.qtAnimationEnable=='false'){
        return false;
    } else {
        return true;
    }
}

function _faceLight(){                      // Returns true if it is okay to send color to LED ring and sets brightness
    if(myCfg.config.faceLightEnable=='false'  || (inQuietMode()==true && myCfg.config.qtFaceLightEnable=='false')){
        if(faceLightOnLast == true){
            console.log('_faceLight() turning off face light (LED Ring)');
            //ledStA.setRingEnable(false);
            ledStA.stripOn(false);
            faceLightOnLast = false;
        }
        return(false); // faceLight is disabled, make sure it is off and retrun false
    } else {
        if(faceLightOnLast == false){
            console.log('_faceLight() turning on face light (LED Ring)');
            //ledStA.setRingEnable(true);
            ledStA.stripOn(true);
            faceLightOnLast = true;
        }
    }
    // if logic makes it to this point it is okay to be on, need to determine brightness:
    if(inNightMode()){
        if(faceLightBrightnessLast != myCfg.config.faceDim){
            ledStA.setBright(Number(myCfg.config.faceDim));
            faceLightBrightnessLast = myCfg.config.faceDim;
        }
    } else {
        if(faceLightBrightnessLast != myCfg.config.faceBright){
            ledStA.setBright(Number(myCfg.config.faceBright));
            faceLightBrightnessLast = myCfg.config.faceBright;
        }        
    }
    return true;    
}

function inQuietMode(){                     // Determine if system should be in quiet mode based on time settings in systemCfg
    var now = new Date();
    var quietStart = new Date(myCfg.config.quietTimeStart);   
    var quietEnd =   new Date(myCfg.config.quietTimeEnd);   

    if(quietEnd.toTimeString() < quietStart.toTimeString()){    // Spans Midnight
        if (now.toTimeString() >= quietStart.toTimeString() || now.toTimeString() < quietEnd.toTimeString()) {
            //console.log('inQuietMode = true');
            if(apiCallRate != myCfg.config.apiMaxCallDelay){changeWxDataPollInterval(myCfg.config.apiMaxCallDelay);}
            inQuietModeStatus = true;
            return true;
        } else {
            //console.log('inQuietMode = false');
            if(apiCallRate != getPrimetimeEvtLoopInterval()){changeWxDataPollInterval(getPrimetimeEvtLoopInterval());}
            inQuietModeStatus = false;
            return false;
        }
    } else {
        if (now.toTimeString() >= quietStart.toTimeString() && now.toTimeString() < quietEnd.toTimeString()) {
            //console.log('inQuietMode = true');
            if(apiCallRate != myCfg.config.apiMaxCallDelay){changeWxDataPollInterval(myCfg.config.apiMaxCallDelay);}            
            inQuietModeStatus = true;
            return true;
        } else {
            //console.log('inQuietMode = false');
            inQuietModeStatus = false;
            if(apiCallRate != getPrimetimeEvtLoopInterval()){changeWxDataPollInterval(getPrimetimeEvtLoopInterval());}            
            return false;
        }
    }
}    

function inNightMode(){                     // Determine if system should be in night moded based on time settings in systmCfg
    var now = new Date();
    var displayBrightStart = new Date(myCfg.config.displayBrightStart);
    var displayBrightEnd =   new Date(myCfg.config.displayBrightEnd);

    if(myCfg.config.displayBrightStartAtSunrise == true){
        displayBrightStart = sunriseTime;
    }
    if(myCfg.config.displayBrightEndAtSunset == true){
        displayBrightEnd = sunsetTime;
    }

    if(displayBrightEnd.toTimeString() < displayBrightStart.toTimeString()){    // Spans Midnight  
        if (now.toTimeString() >= displayBrightStart.toTimeString() || now.toTimeString() < displayBrightEnd.toTimeString()) {
            //console.log('inNightMode = false');
            inNightModeStatus=false;
            return false;
        } else {
            //console.log('inNightMode = true');
            inNightModeStatus=true;
            return true;
        }
    } else {
        if (now.toTimeString() >= displayBrightStart.toTimeString() && now.toTimeString() < displayBrightEnd.toTimeString()){
            //console.log('inNightMode = false');
            inNightModeStatus=false;
            return false;
        } else {
            //console.log('inNightMode = true');
            inNightModeStatus=true;
            return true;
        }
    }
}

function updateSunsetSunrise(){             // Sets global sunriseTime and sunsetTime 
    var lat = Number(myCfg.config.latitude);
    var long = Number(myCfg.config.longitude);    
    var sunTimes = sunCalc.getTimes(new Date(), lat, long);
    sunriseTime = new Date(sunTimes.sunrise);
    sunriseTime.setSeconds(0,0);
    sunsetTime = new Date(sunTimes.sunset);
    sunsetTime.setSeconds(0,0);
    console.log('New times for sunrise ' + sunriseTime.toTimeString() + ' and sunset ' + sunsetTime.toTimeString());
}

function reloadConfigFile(){                // reread rGaugeConfig.json to make new values current
    console.log(`Reloading config file.`);
    dfaltViewNum = Number(myCfg.config.dfaltViewNum);
    startCronJobs();  
    _alphanumeric();
    _faceLight();  
    showData(dfaltViewNum);
}

function sendStatusToMyCfg(ovrRdMsg, ovrRdCat, ovrRdCatTxt ){      // send gauge values to web for display
    /*
    If ovrRdMsg exist it will be displayed insted of normal system status
    ovrRdMsg: message string to display
    ovrRdCat: can be success, info, warning, danger.  Defaults to info.
    ovrRdCatTxt: Will be highlighted as strong text at beginging of ovrRdMsg 
    */

    var stateMsg = ovrRdMsg || ''
    if(stateMsg == ''){
        myCfg.setGaugeStatus('Okay, ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString());
        myCfg.setGaugeValue(wxData.wxObj.temp_f + 'F, ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString());
    } else {
        myCfg.setGaugeStatus(stateMsg)
    }
}


function shutDown(){
    console.log("\nGracefully Shutting Down..." );
    wxData.setWxPollTime(0);
    console.log("Timed Events Stopped.");
    mtrA.setValue(0);
    console.log("Panel Meter is Shutdown.");
    rpio.open(LED1pin, rpio.INPUT); 
    console.log("LED pin set to input.");
    alphNumA.prnStrCntrd8("OFF-LINE");
    console.log("Exit message sent to LED display.");
}

process.on( 'SIGINT', function() {          // Shutdow process
    shutDown();
    process.exit( );
})

