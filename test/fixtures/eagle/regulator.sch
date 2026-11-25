<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<!-- A hand-written fixture for ElectroCAD's Eagle import: two sheets, a regulator with a pin on two
     pads, a dual op-amp with a power gate (one gate mirrored), supply symbols, a net joined across
     sheets by labels and a net joined by name only. -->
<eagle version="9.6.2">
<drawing>
<settings><setting alwaysvectorfont="no"/></settings>
<grid distance="0.1" unitdist="inch" unit="inch" style="lines" multiple="1" display="no" altdistance="0.01" altunitdist="inch" altunit="inch"/>
<layers>
<layer number="91" name="Nets" color="2" fill="1" visible="yes" active="yes"/>
<layer number="94" name="Symbols" color="4" fill="1" visible="yes" active="yes"/>
<layer number="95" name="Names" color="7" fill="1" visible="yes" active="yes"/>
<layer number="96" name="Values" color="7" fill="1" visible="yes" active="yes"/>
</layers>
<schematic xreflabel="%F%N/%S.%C%R" xrefpart="/%S.%C%R">
<libraries>
<library name="rcl">
<packages>
<package name="R0805">
<smd name="1" x="-0.95" y="0" dx="1.3" dy="1.5" layer="1" roundness="25"/>
<smd name="2" x="0.95" y="0" dx="1.3" dy="1.5" layer="1" roundness="25"/>
<wire x1="-0.41" y1="0.635" x2="0.41" y2="0.635" width="0.1524" layer="51"/>
<text x="-1.27" y="1.27" size="1.016" layer="25">&gt;NAME</text>
<text x="-1.27" y="-2.286" size="1.016" layer="27">&gt;VALUE</text>
</package>
<package name="0207/10">
<pad name="1" x="-5.08" y="0" drill="0.8128" shape="octagon"/>
<pad name="2" x="5.08" y="0" drill="0.8128" shape="octagon"/>
<wire x1="-3.175" y1="1.143" x2="3.175" y2="1.143" width="0.1524" layer="21"/>
<wire x1="-3.175" y1="-1.143" x2="3.175" y2="-1.143" width="0.1524" layer="21"/>
</package>
</packages>
<symbols>
<symbol name="R-US">
<wire x1="-2.54" y1="0" x2="-2.159" y2="1.016" width="0.2032" layer="94"/>
<wire x1="-2.159" y1="1.016" x2="2.54" y2="0" width="0.2032" layer="94"/>
<text x="-3.81" y="1.4986" size="1.778" layer="95">&gt;NAME</text>
<text x="-3.81" y="-3.302" size="1.778" layer="96">&gt;VALUE</text>
<pin name="1" x="-5.08" y="0" visible="off" length="short" direction="pas" swaplevel="1"/>
<pin name="2" x="5.08" y="0" visible="off" length="short" direction="pas" swaplevel="1" rot="R180"/>
</symbol>
</symbols>
<devicesets>
<deviceset name="R-US_" prefix="R" uservalue="yes">
<gates><gate name="G$1" symbol="R-US" x="0" y="0"/></gates>
<devices>
<device name="R0805" package="R0805"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""/></technologies></device>
<device name="0207/10" package="0207/10"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""/></technologies></device>
</devices>
</deviceset>
</devicesets>
</library>
<library name="supply1">
<symbols>
<symbol name="GND"><wire x1="-1.905" y1="0" x2="1.905" y2="0" width="0.254" layer="94"/><pin name="GND" x="0" y="0" visible="off" length="point" direction="sup" rot="R270"/></symbol>
<symbol name="VCC"><wire x1="1.27" y1="-1.905" x2="0" y2="0" width="0.254" layer="94"/><pin name="VCC" x="0" y="0" visible="off" length="point" direction="sup" rot="R90"/></symbol>
</symbols>
<devicesets>
<deviceset name="GND" prefix="GND"><gates><gate name="1" symbol="GND" x="0" y="0"/></gates><devices><device name=""><technologies><technology name=""/></technologies></device></devices></deviceset>
<deviceset name="VCC" prefix="P+"><gates><gate name="VCC" symbol="VCC" x="0" y="0"/></gates><devices><device name=""><technologies><technology name=""/></technologies></device></devices></deviceset>
</devicesets>
</library>
<library name="reg">
<packages>
<package name="SOT223">
<smd name="1" x="-2.3" y="-3.15" dx="1.2" dy="2.2" layer="1"/>
<smd name="2" x="0" y="-3.15" dx="1.2" dy="2.2" layer="1"/>
<smd name="3" x="2.3" y="-3.15" dx="1.2" dy="2.2" layer="1"/>
<smd name="4" x="0" y="3.15" dx="3.6" dy="2.2" layer="1"/>
<wire x1="3.2766" y1="1.8034" x2="-3.2766" y2="1.8034" width="0.2032" layer="21"/>
</package>
<package name="SO8">
<smd name="1" x="-1.905" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="2" x="-0.635" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="3" x="0.635" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="4" x="1.905" y="-2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="5" x="1.905" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="6" x="0.635" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="7" x="-0.635" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<smd name="8" x="-1.905" y="2.6" dx="0.6" dy="2.2" layer="1"/>
<circle x="-1.8" y="-0.9" radius="0.2" width="0" layer="21"/>
</package>
</packages>
<symbols>
<symbol name="REG">
<wire x1="-5.08" y1="-5.08" x2="5.08" y2="-5.08" width="0.4064" layer="94"/>
<wire x1="5.08" y1="-5.08" x2="5.08" y2="2.54" width="0.4064" layer="94"/>
<wire x1="5.08" y1="2.54" x2="-5.08" y2="2.54" width="0.4064" layer="94"/>
<wire x1="-5.08" y1="2.54" x2="-5.08" y2="-5.08" width="0.4064" layer="94"/>
<pin name="IN" x="-7.62" y="0" length="short" direction="pwr"/>
<pin name="OUT" x="7.62" y="0" length="short" direction="pas" rot="R180"/>
<pin name="GND" x="0" y="-7.62" length="short" direction="pwr" rot="R90"/>
</symbol>
<symbol name="OPAMP">
<wire x1="-5.08" y1="5.08" x2="-5.08" y2="-5.08" width="0.4064" layer="94"/>
<wire x1="-5.08" y1="-5.08" x2="5.08" y2="0" width="0.4064" layer="94"/>
<wire x1="5.08" y1="0" x2="-5.08" y2="5.08" width="0.4064" layer="94"/>
<pin name="+IN" x="-7.62" y="2.54" visible="pad" length="short" direction="in"/>
<pin name="-IN" x="-7.62" y="-2.54" visible="pad" length="short" direction="in"/>
<pin name="OUT" x="7.62" y="0" visible="pad" length="short" direction="out" rot="R180"/>
</symbol>
<symbol name="PWR">
<pin name="V+" x="0" y="5.08" visible="pad" length="middle" direction="pwr" rot="R270"/>
<pin name="V-" x="0" y="-5.08" visible="pad" length="middle" direction="pwr" rot="R90"/>
</symbol>
<symbol name="FRAME_A4">
<wire x1="0" y1="0" x2="287" y2="0" width="0.1016" layer="94"/>
<wire x1="287" y1="0" x2="287" y2="200" width="0.1016" layer="94"/>
<wire x1="287" y1="200" x2="0" y2="200" width="0.1016" layer="94"/>
<wire x1="0" y1="200" x2="0" y2="0" width="0.1016" layer="94"/>
</symbol>
</symbols>
<devicesets>
<deviceset name="78XX" prefix="U">
<gates><gate name="G$1" symbol="REG" x="0" y="0"/></gates>
<devices><device name="SOT223" package="SOT223"><connects><connect gate="G$1" pin="IN" pad="1"/><connect gate="G$1" pin="GND" pad="2 4"/><connect gate="G$1" pin="OUT" pad="3"/></connects><technologies><technology name="05"><attribute name="MPN" value="LM78M05"/></technology></technologies></device></devices>
</deviceset>
<deviceset name="LM358" prefix="U">
<gates><gate name="A" symbol="OPAMP" x="0" y="0"/><gate name="B" symbol="OPAMP" x="0" y="-20.32"/><gate name="P" symbol="PWR" x="20.32" y="0" addlevel="request"/></gates>
<devices><device name="D" package="SO8"><connects>
<connect gate="A" pin="OUT" pad="1"/><connect gate="A" pin="-IN" pad="2"/><connect gate="A" pin="+IN" pad="3"/>
<connect gate="P" pin="V-" pad="4"/><connect gate="B" pin="+IN" pad="5"/><connect gate="B" pin="-IN" pad="6"/><connect gate="B" pin="OUT" pad="7"/><connect gate="P" pin="V+" pad="8"/>
</connects><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="FRAME_A4"><gates><gate name="G$1" symbol="FRAME_A4" x="0" y="0"/></gates><devices><device name=""><technologies><technology name=""/></technologies></device></devices></deviceset>
</devicesets>
</library>
</libraries>
<attributes/>
<variantdefs/>
<classes><class number="0" name="default" width="0" drill="0"/></classes>
<parts>
<part name="FRAME1" library="reg" deviceset="FRAME_A4" device=""/>
<part name="R1" library="rcl" deviceset="R-US_" device="R0805" value="330"/>
<part name="R2" library="rcl" deviceset="R-US_" device="0207/10" value="10k"/>
<part name="U1" library="reg" deviceset="78XX" device="SOT223" technology="05"/>
<part name="U2" library="reg" deviceset="LM358" device="D" value="LM358D"/>
<part name="GND1" library="supply1" deviceset="GND" device=""/>
<part name="GND2" library="supply1" deviceset="GND" device=""/>
<part name="GND3" library="supply1" deviceset="GND" device=""/>
<part name="GND4" library="supply1" deviceset="GND" device=""/>
<part name="P+1" library="supply1" deviceset="VCC" device=""/>
<part name="P+2" library="supply1" deviceset="VCC" device=""/>
</parts>
<sheets>
<sheet>
<description>Power</description>
<plain>
<text x="20.32" y="101.6" size="2.54" layer="97">Regulator</text>
</plain>
<instances>
<instance part="FRAME1" gate="G$1" x="0" y="0"/>
<instance part="R1" gate="G$1" x="50.8" y="76.2"/>
<instance part="U1" gate="G$1" x="88.9" y="76.2"/>
<instance part="P+1" gate="VCC" x="40.64" y="81.28"/>
<instance part="GND1" gate="1" x="88.9" y="63.5"/>
</instances>
<busses/>
<nets>
<net name="VCC" class="0">
<segment><pinref part="P+1" gate="VCC" pin="VCC"/><pinref part="R1" gate="G$1" pin="1"/>
<wire x1="40.64" y1="81.28" x2="40.64" y2="76.2" width="0.1524" layer="91"/><wire x1="40.64" y1="76.2" x2="45.72" y2="76.2" width="0.1524" layer="91"/></segment>
<segment><pinref part="U1" gate="G$1" pin="IN"/>
<wire x1="81.28" y1="76.2" x2="81.28" y2="83.82" width="0.1524" layer="91"/><label x="81.28" y="83.82" size="1.778" layer="95"/></segment>
</net>
<net name="N$1" class="0">
<segment><pinref part="R1" gate="G$1" pin="2"/>
<wire x1="55.88" y1="76.2" x2="60.96" y2="76.2" width="0.1524" layer="91"/></segment>
</net>
<net name="GND" class="0">
<segment><pinref part="U1" gate="G$1" pin="GND"/><pinref part="GND1" gate="1" pin="GND"/>
<wire x1="88.9" y1="68.58" x2="88.9" y2="63.5" width="0.1524" layer="91"/></segment>
</net>
<net name="VOUT" class="0">
<segment><pinref part="U1" gate="G$1" pin="OUT"/>
<wire x1="96.52" y1="76.2" x2="104.14" y2="76.2" width="0.1524" layer="91"/><label x="103.0" y="77.0" size="1.778" layer="95"/></segment>
</net>
</nets>
</sheet>
<sheet>
<description>Buffer</description>
<plain/>
<instances>
<instance part="R2" gate="G$1" x="50.8" y="50.8" rot="R90"/>
<instance part="U2" gate="A" x="76.2" y="50.8"/>
<instance part="U2" gate="B" x="76.2" y="25.4" rot="MR0"/>
<instance part="U2" gate="P" x="101.6" y="38.1"/>
<instance part="GND2" gate="1" x="50.8" y="40.64"/>
<instance part="GND3" gate="1" x="83.82" y="17.78"/>
<instance part="GND4" gate="1" x="101.6" y="27.94"/>
<instance part="P+2" gate="VCC" x="101.6" y="45.72"/>
</instances>
<busses/>
<nets>
<net name="VOUT" class="0">
<segment><pinref part="R2" gate="G$1" pin="2"/><pinref part="U2" gate="A" pin="+IN"/>
<wire x1="50.8" y1="55.88" x2="50.8" y2="60.96" width="0.1524" layer="91"/>
<wire x1="50.8" y1="60.96" x2="60.96" y2="60.96" width="0.1524" layer="91"/>
<wire x1="60.96" y1="60.96" x2="60.96" y2="53.34" width="0.1524" layer="91"/>
<wire x1="60.96" y1="53.34" x2="68.58" y2="53.34" width="0.1524" layer="91"/>
<label x="55.88" y="61.5" size="1.778" layer="95"/></segment>
</net>
<net name="GND" class="0">
<segment><pinref part="R2" gate="G$1" pin="1"/><pinref part="GND2" gate="1" pin="GND"/>
<wire x1="50.8" y1="45.72" x2="50.8" y2="40.64" width="0.1524" layer="91"/></segment>
<segment><pinref part="U2" gate="B" pin="-IN"/><pinref part="GND3" gate="1" pin="GND"/>
<wire x1="83.82" y1="22.86" x2="83.82" y2="17.78" width="0.1524" layer="91"/></segment>
<segment><pinref part="U2" gate="P" pin="V-"/><pinref part="GND4" gate="1" pin="GND"/>
<wire x1="101.6" y1="33.02" x2="101.6" y2="27.94" width="0.1524" layer="91"/></segment>
</net>
<net name="VCC" class="0">
<segment><pinref part="U2" gate="P" pin="V+"/><pinref part="P+2" gate="VCC" pin="VCC"/>
<wire x1="101.6" y1="43.18" x2="101.6" y2="45.72" width="0.1524" layer="91"/></segment>
</net>
<net name="AOUT" class="0">
<segment><pinref part="U2" gate="A" pin="OUT"/><pinref part="U2" gate="A" pin="-IN"/><pinref part="U2" gate="B" pin="+IN"/>
<wire x1="83.82" y1="50.8" x2="86.36" y2="50.8" width="0.1524" layer="91"/>
<wire x1="86.36" y1="50.8" x2="86.36" y2="43.18" width="0.1524" layer="91"/>
<wire x1="86.36" y1="43.18" x2="66.04" y2="43.18" width="0.1524" layer="91"/>
<wire x1="66.04" y1="43.18" x2="66.04" y2="48.26" width="0.1524" layer="91"/>
<wire x1="66.04" y1="48.26" x2="68.58" y2="48.26" width="0.1524" layer="91"/>
<wire x1="86.36" y1="43.18" x2="86.36" y2="27.94" width="0.1524" layer="91"/>
<wire x1="86.36" y1="27.94" x2="83.82" y2="27.94" width="0.1524" layer="91"/></segment>
</net>
</nets>
</sheet>
</sheets>
</schematic>
</drawing>
</eagle>
