## THỰC HÀNH LINUX

Việc thực hành trên lớp không bao phủ toàn bộ kiến thức học phần Linux, do đó sinh viên chủ động luyện tập thực hành trên Laptop tại nhà theo hướng dẫn, yêu cầu của GV phụ trách học phần.

Mạc Văn Quang

<!-- image -->

## 1. Cài đặt linux trên VMWare (thiết lập RAM &gt;=2Gb/ HDD&gt;=20GB);

Phân ca lại ổ đĩa cứng vật lý (nếu cần)

- Dùng phần mềm boot Hiren USB - AOMEI partition
- Windows Disk Management / Shrink Volume

Thiết lập thông mạng máy vật lý và máy ảo

VMware : VNet8 =  Thiết lập IP tĩnh trên 2 máy; Bridge = Thông mạng vật lý và máy ảo Lựa chọn bản phủ hợp cấu hình máy: (ex: Fedora 23; Ubuntu 16...)

## 2. Cài đặt Linux ra USB (tự học)

- Dùng phần mềm : linux creator USB, hoặc Refus để chuyể Linux .. iso to USB
- Thiết lập BIOS setup:  Boot from USB Lagacy
3. Các thao tác cơ bản rên linux

## Một số lệnh yêu cầu đăng nhập root, hoặc mượn quyền $sudo  &lt;lệnh [tham số]&gt;

Các lệnh ; Shutdown, Init0 (init6), halt, ....

thực hiện lệnh $su; #time; #date; $pwd; #id; $clear; $w  [user],...

Đăng nhập với tài khoản root , mật khẩu thiết lập khi cài đặt

(mode run live  = &gt; root password = Empty)

Xem trợ giúp lệnh bất kỳ: $man &lt;tên lệnh&gt;

4. Xem  file nguồn mở về  "6 level"  khởi động của Linux

Dùng lệnh cat/ vi... để xem nội dung file

/etc/init.d/fstab

(nếu sửa nội dung không nghi lại được =&gt; vì sao, khắc phục?)

5.  Run live linux / Installing to hardisk

Run live linux: boot from ISO file hoặc USB Boot Creator - Cài đặt ứng dụng bổ sung, hoặc cấu hình các dịch vụ sẽ không lưu lại khi reboot (giống như đóng băng ổ đĩa), chỉ dùng khi học tập, nghiên cứu.

Installing to hardisk (HDD &gt;=20Gb) , cài đặt bổ sung các phần mềm, hoặc cấu hình các dịch vụ sẽ lưu lại bình thường, các máy làm việc trên linux cần cài đặt (thay vì chạy trực tiếp)

Text mode Install (Old Version) / GUI mode Install

6. Đưa dữ liệu vào máy ảo Linux:

Đã Cài đặt: Trên Windows (dùng phần mềm Ultra ISO -&gt; Tạo file .iso)

Trên VMware  (cdrom =&gt; chỉ ra đường dẫn tới file iso), chọn "connect" khi kết nối cdrom Trên Linux: Mở ổ đĩa cdrom; copy dư liệu vào ổ đĩa góc (#mount kết nối tới ổ đĩa cdrom ).

Run Live: Không nhận ổ ảo Cdrom, cài đặt trực tiếp từ interet $sudo dnf  install  &lt;package&gt;

Từ USB Disk (không nén file rpm) OK =&gt; (Ctrl + Alt + Enter) để nhận USB disk trên VMWare

<!-- image -->

## CÁC LÊNH QUẢN LÝ TẬP TIN VÀ THƯ MỤC (CLI mode)

## 1. Tạo cây thư mục:

```
/TM1/TM11    và  TM1/TM12/SV Thực hiện thao tác lệnh mkdir, cp, mv, rm,....  (cp [-R]. rm [-r], mv .. Dùng  lệnh thao tác trên tập tin: cat> để tạo tập tin F1.txt  (Nội dung tùy ý) trong thư mục /TM1/TM11 (file đã tồn tại bị xóa, tạo mới)
```

2. Dùng lênh $vi thực hiện {tạo mới/ hoặc sửa nội dung "text file"}

```
($vi file => fila đã có trong thư mục hiện tại = xem, sửa; file chưa tồn tại = tạo mới)
```

Chuyển đổi chế độ soạn thảo ( Insert key đề trên chèn); Ctrl +C khi kết thúc soạn thảo

Thực hiện sửa nội dung file f1.txt , ghi lại và thoát ( :wq! ), xem lại nội dung đã ghi:

Thêm nội dung file f1.txt  vào cuối , không ghi lại và thoát  ( :q! ), xem lại nội dung thay đổi

Tham khảo thêm lệnh cat&gt; , more, less, file  (Slide 23,24 chương 2)

Ghi chú

; lệnh

$cat&gt;

3. Công cụ quản trị file

Cài dặt bổ sung gói tin mc  (Text mode), sử dụng các phím F1-F9

Ứng dụng quản lý File Brower (GUI mode) Create Folder/ Delete, Move/ Cut/ Copy / Paste...

4. Kiểm tra shell mặc định linux (bash shell #)

```
Thay đổi hệ shell thành C-Shell ; kiểm tra lại sự thay đổi bởi dấu nhắc lệnh #chsh  -s  /bin/bash #chsh  -s  /usr/local/bin/bash username Kiểm tra file mx nguồn: ~/.profile và ~/.login
```

## LÀM VIỆC CỬA SỔ ĐỒ HỌA VÀ CÁC ỨNG DỤNG (GUI mode)

1. Hệ thống X-Window (menu)

Logout/ Login root / Switch User/ Shutdown/ restart

2. Các ứng dụng trên đồ họa

Office/ Internet/ Graphic/ Tool

3. Phân biệt các giao diện đồ họa (tự đọc lý thuyết):

GNOME, KDE, XFCE, MATE, ...

filename

để tạo file mới,

$cat  filename

để xem nội dụng, thoát Ctrl+C)

## 1. Tạo cây thư mục:  TM1/TM11/F1.txt

(nội dung F1.txt tùy ý, dùng lệnh $cd để chuyển vào thư mục /TM1/TM11)

- Xem huộc tính ($ls  -l  filename) nhận biết các quyền,

trên mỗi đối tượng có quyền nào, người chủ sở hữu , nhóm chủ

- Thay đổi quyền (#chmod) trên file F1.txt ; Loại bỏ quyền (-) , thêm quyền (+), gán quyền (=)
- Thay đổi quyền trên file F1.txt ; theo biểu thức số ( r =4; w =2, x =1; -=0)
- Thay đổi quyền mặc định trên F1.txt   ($umask)
- Tạo người dùng mới #useradd U1,  Thay đổi người chủ sở hữu (#chown) trên file F1.txt thành U2

## 2. Quản lý thiết bị lưu trữ trên linux

- +Định dạng (Formatting Disk) slide 3- chương 3
- +Câu lệnh: #fdisk  -l, ....
- +Đồ họa: File Browser, Parted, Gnome Disk,...
- +Gắn kết (ánh xạ) ổ đĩa #mount/ #umount

## 3. Thiết lập hạn ngạch đĩa cho người dùng

Tạo tài khoản người dùng U1

Đặt hạn ngạch ổ đĩa cho người dùng U1 là 500Mb

## 4. Quản lý file nén

- -Quản lý nén file lệnh : #tar,
- Text mode: $mc
- (installing:   #yum mc....rpm)
- -Quản lý nén file  đồ họa : 7zip,

## 5. Quản lý gói phần mềm trên máy cục bộ

- Thực hiện qua lệnh (rpm, deb)
- Quản lý trên đồ họa (installing)
- Cài dặt phần mềm từ nguồn mở (tự học), cài đặt Unikey for Linux

## 6. Quản lý gói phần mềm trên Internet

- B1. Kiểm tra kết nối internet từ máy vật lý (ping   www.google.com.vn)
- B1. VMware (network = bridge) Kết nối mạng chuyển tiếp tới qua máy vật lý

# dnf ; (#yum), #apt-get,...

Hướng dẫn Slide 25-28 (chương 4)

<!-- image -->

## QUẢN LÝ NGƯỜI DÙNG VÀ NHÓM

## 1. Các lệnh với người dùng

```
(tạo người dùng U1,U2, đặt mật khẩu U1,U2) #id, #w [user]; who ...; $su;... - Lệnh slide 9,10 chương 4
```

## 2. Các lệnh với nhóm

(Tạo nhóm G1, gán U1 vào nhóm G1, tạo nhóm G2, gán U2, root vào G2)

3. Quản lý người dùng, nhóm trên nguồn mở

Xem nội dung file nguồn mở về người dùng, nhóm

4. Quản lýngười dùng, nhóm trên đồ họa

## GHI NHẬT KÝ, SAO LƯU VÀ PHỤC HỒI

## 1. Quản lý nhật ký

```
File: /var/log (Slide 20- chương 6) Công cụ quản lý nhật ký : Journalctl; logger; newsyslog; logRotate,...
```

## 2. Sao lưu

Sao lưu tập tin, thư mục #tar

Sao lưu ổ đĩa  #df, #dd, #sfdisk

#sfdisk -d /

dev/sda

## 3. Phục hồi (CLI mode)

#dump [-level#] [-ackMnqSuv] [-A file] [-B records] [-b blocksize] [-d density] [-D file] [-e inode [-s feet] [-T date] [-y] [-zcompression level] files-to-dump  dump [-W | -w]

numbers] [-E file] [-f file] [-F script] [-h level] [-I nr errors] [-jcompression level] [-L label] [-Q file] https://www.tutorialspoint.com/unix\_commands/dump.htm #restore [-a/-c/-C/-d/-f/-h/-p/-r/-R/-t/-x/-k/-m/-N/-o/-p/-Q/-u/-v/-V/-y]

## 4. Công cụ sao lưu/ phục hồi trên đồ họa (GUI mode)

- Cài đặt bổ sung Sbackup ;  hoặc AOMEI partition for Linux
- Công cụ khác: Partimage; Partclone, Clonezilla; Gdisk (tự học)
- Cấu hình RAID Linux Server (tự học)
- Sử dụng đĩa cứu hộ máy tính Hiren boot USB  (tự học)

https://mangmaytinh.net/threads/sao-luu-va-khoi-phuc-lai-mot-bang-phan-vung-tren-linux.181/

| sfdisk -f

<!-- image -->

/dev/sdd

(sao chép phân vùng sda sang sdd)

## TH 5.

## GIÁM SÁT HỆ THỐNG LINUX

## 5.1 Quản lý tiến trình và tác vụ (CLI mode)

#kill; #killall #ps (slide 5,6 chương 6) #bg; #fg #nice; #renice #pstree #xclock #hub; #nohub

## 5.2 Lập lịch làm việc

Công cụ: Actiona; Autokey; Textpander; Gnome-Schedule

## 5.3 Giám sát hệ thống phần cứng

- -Giám sát đọc đĩa cứng #iostat

#hwinfo, #free;#vmstat; #lsof; #iotop; #psacct;#top;

## 5.4 Công cụ giám sát linux trên đồ họa (GUI mode)

Slide 36- Chương 6

#htop; #monit; #monitorix; #colectl; ..

## TH 6.

## QUẢN LÝ KẾT NỐI MẠNG LINUX

## 6.1 Kiểm tra kết nối vật lý

Cable (Wire Connect) Wireless Connect (WiFi/WLAN)

## 6.2 Công cụ quản lý mạng bằng câu lệnh (CLI mode)

#ifconfig [-a]

#ifconfig [ip\_add netmask] up /down

#netstat  [-a/ - b/ -e / -i]  hoặc  #ss (ss tương tự netstat)

#ping  IP/hostname/ Domain\_name

#host (tra cứu tên máy Local)/ #arp (tra cứu bảng ARP table)

#nslookup  Domain\_name  hoặc  #dig (dig tương đương nslookup)

#route (hiển thị thông tin routing table)

#iwconfig (cấu hình mạng wifi)

#traceroute  IP/Domain\_name

#yum (dnf)  install traceroute  (ubuntu ; apt-get install traceroute)

$ ip address; $ ip add; $ ip route; $ ip link; $ ip -4 address

Internet web: #curl; #wget; #mtr; #whois; #ifplugstatus

## 6.3 Chia sẻ tài nguyên mạng LAN

- Cài đặt dịch vụ samba (smb) trên linux
- Chia sẻ tài nguyên trên linux cho máy Windows
- Chia sẻ tài nguyên mạng trên Windows cho máy Linux

(Thực hiện thông mạng trên VMware =&gt; Network card = bridge (vật lý); VNet8 (IP tĩnh)

## 6.3 Công cụ kiểm tra mạng trên đồ họa  (GUI mode)

Slide 46,47 Chương 6

- 6.4 Công cụ kiểm tra mạng trên file nguồn mở

Slide 44, chương 6

Slide 54, chương 6

- 6.5 Kiểm tra tôc độ, băng thông mạng Internet

https://www.speedtest.net

- 6.5 cài dặt và thiết lập Firewall (tự học)

Slide 55- chương 6

- 6.5 Quản tri từ xa (tự học)

- CLI:  #telnet, #ssh  (installing)

GUI: webmin (installing)