const fs =              require("fs");
const cp =              require('child_process');
const EventEmitter =    require('events');
const BLEperipheral =   require("ble-peripheral");
var self;

/**
 * This class provides an interface to the gauge’s factory default configuration settings. Typically, these settings are stored in a file called gaugeConfig.json, with user modifications to the factory defaults in a file called modifiedConfig.json. 
 * This class also provides a frontend to the irdTxClass and  blePeripheral class in the setGaugeStatus and setGaugeValue methods.
 * 
 * ** * gaugConfig.json must have key fields such as UUID and dBusName and conform to a JSON format.  See the README.md for details or the smaple file located in ./samples/sample_gaugeConfig.json **
 * 
 * typical setup call ->const myAppMan = new AppMan(__dirname + '/gaugeConfig.json', __dirname + '/modifiedConfig.json');<-
 * 
 * @param {string} defaultGaugeConfigPath gaugeConfig.json location. Example: (__dirname + '/gaugeConfig.json'). This file must exist see ./samples/sample_gaugeConfig.json for an example format
 * @param {string} modifiedConfigMasterPath modifiedConfig.json location. Example: (__dirname + '/modifiedConfig.json'). This file will be created on first write if it doesn't exist. 
 */
class appManager extends EventEmitter{
    constructor(defaultGaugeConfigPath = '', modifiedConfigMasterPath = ''){
        super();
        
        this.defaultConfigFilepath = defaultGaugeConfigPath;
        this.defaultConfigMaster = {};      
        if (fs.existsSync(this.defaultConfigFilepath)){
            this.defaultConfigMaster = JSON.parse(fs.readFileSync(this.defaultConfigFilepath))
        } else {
            console.log('Error Config file located at ' + this.defaultConfigFilepath + ', not found!');
            console.log('From:' + __filename);
            throw new Error('Default Config File not found.');
        };
        this.modifiedConfigFilePath = modifiedConfigMasterPath;
        this.modifiedConfigMaster = {};
        if (fs.existsSync(this.modifiedConfigFilePath)){this.modifiedConfigMaster = JSON.parse(fs.readFileSync(this.modifiedConfigFilePath))};

        this.config = {...this.defaultConfigMaster, ...this.modifiedConfigMaster};
        this.status = 'ipl, ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString();
        this.value = 'Not Set Yet';
        this._okToSend = true;
        this.bPrl = new BLEperipheral(this.config.dBusName, this.config.uuid, this._bleConfig, false);
        self = this;  

        this.bPrl.on('ConnectionChange', (connected)=>{
            var bleUserName = '';
            if(this.bPrl.client.name == ''){
              bleUserName = this.bPrl.client.devicePath;
            } else {
              bleUserName = this.bPrl.client.name;
            };
            if(connected == true){
              console.log('--> ' + bleUserName + ' has connected to this server at ' + (new Date()).toLocaleTimeString());
              if(this.bPrl.client.paired == false){
                console.log('--> CAUTION: This BLE device is not authenticated.');
              }
            } else {
              console.log('<-- ' + bleUserName + ' has disconnected from this server at ' + (new Date()).toLocaleTimeString());
              if(this.bPrl.areAnyCharacteristicsNotifying() == true){
                console.log('Restarting gatt services to cleanup leftover notifications...')
                this.bPrl.restartGattService();
              };
            };
        });
    };

    /** Sets BLE gauge vlaue and fires BLE notify
     * 
     * @param {*} value is the gauge vlue
     */
    setGaugeValue(value){
        var logValue = value.toString() + ', ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString();
        this.value = logValue;
        this.gaugeValue.setValue(logValue);

        if(this.gaugeValue.iface.Notifying && this.bPrl.client.connected){
            this.gaugeValue.notify();
        };
        return true;
    };

    /** Sets BLE gaugeStatus and fires BLE notify
     * 
     * @param {string} statusStr status string to set. Suggest including a time stamp in the string for exampel 'Okay, 8:14:25AM, 2/10/2019'
     */
    setGaugeStatus(statusStr){
        this.status = statusStr;
        this.gaugeStatus.setValue(statusStr);

        if(this.gaugeStatus.iface.Notifying && this.bPrl.client.connected){
            this.gaugeStatus.notify();
        };
    };  
    
    sendAlert(objectToSend = {[this.config.descripition]:"1"}){
        console.log('Sending Alert....')
        console.dir(objectToSend,{depth:null});
        try{
        //var objAsStr = JSON.stringify(objectToSend);
        //var asArry = objAsStr.split('');
        var asArry = JSON.stringify(objectToSend).split('');
        var nums = '[';
        asArry.forEach((val, indx)=>{
            nums += '0x' + val.charCodeAt().toString(16);
            if(indx + 1 != asArry.length){nums += ','};
        })
        nums += ']';
        console.log('Calling gdbus to send alert to rgMan...');
        var result = cp.execSync("/usr/bin/gdbus call --system --dest com.rgMan --object-path /com/rgMan/gaugeAlert --method org.bluez.GattCharacteristic1.WriteValue " + nums);
        console.log('result = ' + result);
        } catch(err){
            console.log('Error when trying to sendAlert to rgMan ' + err);
        };
    };

    /** Saves custom config items to the config file located in modifiedConfigMasterPath 
     * Item to be saved should be in key:value format.  For example to seave the IP address of a device call this method with
     * saveItem({webBoxIP:'10.10.10.12});
     * @param {Object} itemsToSaveAsObject 
     */
    saveItem(itemsToSaveAsObject){
        console.log('saveItem called with:');
        console.log(itemsToSaveAsObject);
    
        var itemList = Object.keys(itemsToSaveAsObject);
        itemList.forEach((keyName)=>{
            this.modifiedConfigMaster[keyName] = itemsToSaveAsObject[keyName];
        })
        console.log('Writting file to ' + this.modifiedConfigFilePath);
        fs.writeFileSync(this.modifiedConfigFilePath, JSON.stringify(this.modifiedConfigMaster));
        this._reloadConfig();
    };

    _reloadConfig(){
        console.log('config reloading...');
        this.modifiedConfigMaster = {};
        if (fs.existsSync(this.modifiedConfigFilePath)){
            this.modifiedConfigMaster = JSON.parse(fs.readFileSync(this.modifiedConfigFilePath))
        };
        this.config = {...this.defaultConfigMaster, ...this.modifiedConfigMaster};
        this.readConfig.setValue(JSON.stringify(this.config));
        console.log('firing "Update" event...');
        this.emit('Update');
    };

    _bleConfig(DBus){
        self._bleMasterConfig();

    }

    _bleMasterConfig(DBus){
        //this.bPrl.logCharacteristicsIO = true;
        //this.bPrl.logAllDBusMessages = true;
        console.log('Initialize charcteristics...')
        this.appVer =       this.bPrl.Characteristic('001d6a44-2551-4342-83c9-c18a16a3afa5', 'appVer', ["encrypt-read"]);
        this.gaugeStatus =  this.bPrl.Characteristic('002d6a44-2551-4342-83c9-c18a16a3afa5', 'gaugeStatus', ["encrypt-read","notify"]);
        this.gaugeValue =   this.bPrl.Characteristic('003d6a44-2551-4342-83c9-c18a16a3afa5', 'gaugeValue', ["encrypt-read","notify"]);
        this.gaugeCommand = this.bPrl.Characteristic('004d6a44-2551-4342-83c9-c18a16a3afa5', 'gaugeCommand', ["encrypt-read","encrypt-write"]);
        this.readConfig =   this.bPrl.Characteristic('3ddc0611-272e-4669-80b4-6989687eb1dd', 'readConfig', ["encrypt-read","encrypt-write","notify"]);
        this.writeConfig =  this.bPrl.Characteristic('8f92ddf7-dbf2-481d-8e9f-14f37ca7dcef', 'writeConfig', ["encrypt-write"]);
    
        console.log('Registering event handlers...');
        this.gaugeCommand.on('WriteValue', (device, arg1)=>{
            var cmdNum = arg1.toString()
            //var cmdValue = arg1[1]
            var cmdResult = 'okay';
            console.log(device + ' has sent a new gauge command: number = ' + cmdNum);
    
            switch (cmdNum) {
                case '6':    
                    console.log('Resetting gauge configuration to default.')
                    if (fs.existsSync(this.modifiedConfigFilePath)){
                        console.log('Removing custom configuration file' + this.modifiedConfigFilePath);
                        this.setGaugeStatus('Removing custom configuration file and resetting gauge to default config. ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString());
                        fs.unlinkSync(this.modifiedConfigFilePath);
                        this._reloadConfig();
                    } else {
                        console.log('Warning: Custom configuration file not found.');
                        cmdResult='Warning: Custom configuration file not found.'
                    };                   
                break;
                    
                case "20":   
                    console.log('Test: Flag Alert to rgMan');
                    this.sendAlert({[this.config.descripition]:"1"});
                break;

                case "21":  
                    console.log('test: Clear Alert to rgMan');
                    this.sendAlert({[this.config.descripition]:"0"});
                break;
            
                default:
                    console.log('no case for ' + cmdNum);
                    cmdResult='Warning: no case or action for this command.'
                break;
            };
            this.gaugeCommand.setValue('Last command num = ' + cmdNum + ', result = ' + cmdResult + ', at ' + (new Date()).toLocaleTimeString() + ', ' + (new Date()).toLocaleDateString());
        });   
        
        this.appVer.on('ReadValue', (device) =>{
            console.log(device + ' requesting app version')
            this.appVer.setValue((JSON.parse(fs.readFileSync('package.json'))).version);
        })

        this.readConfig.on('WriteValue', (device, arg1)=>{
            /**
             * This characteristc will read large amounts of data by sending items in an array one record at a time.  
             * Write a "?" to the characteristic and it will return the number of records in the array.
             * Then write the number of the record you would like to receive. 
             */
            console.log(device + ', is writing to gaugeConfig ' + arg1);
            var keysArry = [];
            keysArry = Object.keys(this.config);
            var keysCnt = keysArry.length;

            if(arg1.toString() == "?"){
                console.log('gaugeConfig request for record count returning ' + keysCnt);
                this.readConfig.setValue(keysCnt.toString());
                this.readConfig.notify()
            } else if (arg1 >= 0 && arg1 <= keysCnt){
                var x = {[keysArry[arg1]]:this.config[keysArry[arg1]]}
                var mOB = JSON.stringify(x) 
                console.log("Request for record " + arg1)
                console.dir(x,{depth:null})
        
                this.readConfig.setValue(mOB);
                this.readConfig.notify();
            } else {
                try {
                    //arg1 = {"KeyToLookup":"key name to lookup"} to be saved in modifiedConfig.json
                    console.log("Checking to see if this is a read request for an object")
                    var readObj = JSON.parse(arg1);
                    var xKey = readObj["KeyToLookup"];
                    console.log("Requesting lookup for key = " + xKey);
                    var xVal = this.config[xKey];
                    var xJson = {[xKey]:xVal};
                    console.log("Stringifying the following:");
                    console.dir(xJson, {depth:null});
                    var xJsonStr = JSON.stringify(xJson);
                    console.log("setting value to " + xJsonStr);

                    this.readConfig.setValue(xJsonStr);
                    this.readConfig.notify();
                } catch {
                    console.log('Warnning: gaugeConfig request for record out of range.  Requested record = ' + arg1);
                };
            };
        });

        this.writeConfig.on('WriteValue', (device, arg1)=>{
            //arg1 = {"key":"value"} to be saved in modifiedConfig.json
            console.log(device + ', is saving new gauge value ' + arg1);
            var pObj = JSON.parse(arg1);    
            this.saveItem(pObj);
        });
        
        console.log('setting default characteristic values...');
        this.gaugeValue.setValue(this.value);
        this.gaugeStatus.setValue(this.status)
        this.readConfig.setValue(Object.keys(this.config).length.toString());
    };

};

module.exports = appManager;
